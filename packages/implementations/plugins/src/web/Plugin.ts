/**
 * WebPlugin：provider-neutral 的联网与浏览器能力边界。
 *
 * 关键点（中文）
 * - 浏览器 provider 在 Action 首次使用时按执行作用域惰性创建。
 * - 搜索、文档读取与浏览器 session 是三个独立能力。
 * - 浏览器长期资源由 provider 拥有，并在 Plugin dispose 时统一释放。
 */

import { Plugin, create_action } from "@downcity/city/plugin";
import type {
  PluginJsonObject,
  PluginActionResult,
  PluginAvailability,
} from "@downcity/city/plugin";
import { z } from "zod";
import type {
  BrowserActInput,
  BrowserCloseSessionInput,
  BrowserCreateSessionInput,
  BrowserExtractInput,
  BrowserObserveInput,
  BrowserProvider,
  BrowserProviderFactory,
  BrowserSemanticActInput,
  BrowserSemanticExtractInput,
  WebDocumentProvider,
  WebOpenInput,
  WebPluginOptions,
  WebPluginConfig,
  WebSearchInput,
  WebSearchProvider,
} from "@/web/types/WebPlugin.js";
import { WEB_PLUGIN_ACTIONS } from "@/web/types/WebPlugin.js";
import { PlaywrightBrowserProvider } from "@/web/providers/PlaywrightBrowserProvider.js";
import { LocalBrowserProvider } from "@/web/providers/LocalBrowserProvider.js";
import { TavilySearchProvider } from "@/web/providers/TavilySearchProvider.js";
import { ExaSearchProvider } from "@/web/providers/ExaSearchProvider.js";
import { FetchDocumentProvider } from "@/web/providers/FetchDocumentProvider.js";
import { FirecrawlDocumentProvider } from "@/web/providers/FirecrawlDocumentProvider.js";
import { register_web_plugin_config_actions } from "@/web/host/WebPluginConfigActions.js";

const URL_SCHEMA = z.string().url();
const SESSION_ID_SCHEMA = z.string().trim().min(1);
const MAX_CHARS_SCHEMA = z.number().int().min(1).max(100_000).optional();

/** 校验 ref/selector 目标并要求 ref 携带观察代次。 */
const BROWSER_TARGET_SCHEMA = z.object({
  ref: z.string().trim().min(1).optional(),
  selector: z.string().trim().min(1).optional(),
  observation_generation: z.number().int().min(1).optional(),
}).superRefine((value, context) => {
  if (Boolean(value.ref) === Boolean(value.selector)) {
    context.addIssue({
      code: "custom",
      message: "Exactly one of ref or selector is required",
    });
  }
  if (value.ref && value.observation_generation === undefined) {
    context.addIssue({
      code: "custom",
      message: "observation_generation is required with ref",
    });
  }
});

const BROWSER_ACTION_SCHEMA = z.discriminatedUnion("type", [
  z.object({ type: z.literal("goto"), url: URL_SCHEMA }),
  BROWSER_TARGET_SCHEMA.extend({ type: z.literal("click") }),
  BROWSER_TARGET_SCHEMA.extend({ type: z.literal("fill"), value: z.string() }),
  BROWSER_TARGET_SCHEMA.extend({
    type: z.literal("press"),
    key: z.string().trim().min(1),
  }),
  z.object({
    type: z.literal("scroll"),
    x: z.number().optional(),
    y: z.number().optional(),
  }),
  z.object({
    type: z.literal("wait"),
    milliseconds: z.number().int().min(0).max(60_000).optional(),
  }),
]);

/** 把异常转换为 action 的稳定失败结果。 */
function failure_result(error: unknown): PluginActionResult<PluginJsonObject> {
  const message = error instanceof Error ? error.message : String(error);
  return { success: false, error: message, message };
}

/** WebPlugin：组合显式注入的 Web provider。 */
export class WebPlugin extends Plugin {
  /** 当前 plugin 稳定名称。 */
  readonly name = "web";

  /** 插件标题。 */
  readonly title = "Web";

  /** 插件说明。 */
  readonly description =
    "Provides structured web search, document reading, and browser sessions through configured providers.";

  /** 构造时注入的 Provider 与固定配置。 */
  private readonly options: WebPluginOptions;

  /** WebPlugin 自己拥有的搜索 Provider。 */
  private readonly search_provider: WebSearchProvider | undefined;

  /** WebPlugin 自己拥有的文档 Provider。 */
  private readonly document_provider: WebDocumentProvider | undefined;

  /** 可选的浏览器 Provider 工厂。 */
  private readonly browser_provider_factory: BrowserProviderFactory | undefined;

  /** 按 Agent 与 Workspace 执行作用域持有的浏览器 Provider。 */
  private readonly browser_providers = new Map<string, Promise<BrowserProvider>>();

  constructor(options: WebPluginOptions = {}) {
    super();
    assert_supported_config(options.config);
    this.options = {
      ...(options.config ? { config: { ...options.config } } : {}),
      ...(options.search_provider ? { search_provider: options.search_provider } : {}),
      ...(options.document_provider ? { document_provider: options.document_provider } : {}),
      ...(options.browser_provider_factory
        ? { browser_provider_factory: options.browser_provider_factory }
        : {}),
    };
    this.search_provider = options.search_provider;
    this.document_provider = options.document_provider;
    this.browser_provider_factory = options.browser_provider_factory;
  }

  /** 注册 Web Plugin 的唯一配置 actions。 */
  initialize(context: import("@downcity/city/plugin").PluginLifecycleContext): void {
    register_web_plugin_config_actions(context, {
      after_save: async () => await this.dispose_all_browser_providers(),
    });
  }

  /** 释放当前 Plugin 实例持有的全部浏览器资源。 */
  async dispose(): Promise<void> {
    const providers = new Set<WebSearchProvider | WebDocumentProvider>([
      ...(this.search_provider ? [this.search_provider] : []),
      ...(this.document_provider ? [this.document_provider] : []),
    ]);
    const results = await Promise.allSettled([
      this.dispose_all_browser_providers(),
      ...[...providers].map(async (provider) => await provider.dispose?.()),
    ]);
    const errors = rejected_reasons(results);
    if (errors.length > 0) {
      throw new AggregateError(errors, "WebPlugin disposal failed");
    }
  }

  /** 关闭全部按旧配置创建的浏览器 provider。 */
  private async dispose_all_browser_providers(): Promise<void> {
    const providers = [...this.browser_providers.values()];
    this.browser_providers.clear();
    const results = await Promise.allSettled(providers.map(async (provider_promise) => {
      const provider = await provider_promise;
      await provider.dispose();
    }));
    const errors = rejected_reasons(results);
    if (errors.length > 0) {
      throw new AggregateError(errors, "WebPlugin browser providers disposal failed");
    }
  }

  /** 返回当前作用域配置的浏览器 provider。 */
  private async ensure_browser_provider(
    context: import("@downcity/city/plugin").PluginContext,
  ): Promise<BrowserProvider | undefined> {
    const scope_key = web_provider_key(context);
    const existing = this.browser_providers.get(scope_key);
    if (existing) return await existing;
    const config = this.resolve_config(context);
    const factory = this.browser_provider_factory
      ?? resolve_builtin_browser_factory(config);
    if (!factory) return undefined;
    const provider_promise = Promise.resolve(factory({
      agent_id: context.agent.id,
      workspace_id: context.workspace.id,
      data_path: context.storage.path,
      env: context.workspace.env,
      config,
    }));
    this.browser_providers.set(scope_key, provider_promise);
    try {
      return await provider_promise;
    } catch (error) {
      if (this.browser_providers.get(scope_key) === provider_promise) {
        this.browser_providers.delete(scope_key);
      }
      throw error;
    }
  }

  /** 合并 City 配置与构造时固定配置。 */
  private resolve_config(
    context: import("@downcity/city/plugin").PluginContext,
  ): WebPluginConfig {
    const config = {
      search_provider: "auto",
      document_provider: "fetch",
      browser_provider: "local",
      timeout_ms: 30_000,
      max_observation_chars: 12_000,
      ...context.config,
      ...this.options.config,
    } as WebPluginConfig;
    assert_supported_config(config);
    return config;
  }

  /** 根据配置和当前环境选择搜索 Provider。 */
  private resolve_search_provider(
    context: import("@downcity/city/plugin").PluginContext,
    config: WebPluginConfig,
  ): WebSearchProvider | undefined {
    if (this.search_provider) return this.search_provider;
    const selected = config.search_provider ?? "auto";
    if (selected === "disabled") return undefined;
    const tavily_api_key = read_secret(config.tavily_api_key, context.workspace.env.TAVILY_API_KEY);
    const exa_api_key = read_secret(config.exa_api_key, context.workspace.env.EXA_API_KEY);
    const timeout_ms = config.timeout_ms;
    if ((selected === "auto" || selected === "tavily") && tavily_api_key) {
      return new TavilySearchProvider({ api_key: tavily_api_key, timeout_ms });
    }
    if ((selected === "auto" || selected === "exa") && exa_api_key) {
      return new ExaSearchProvider({ api_key: exa_api_key, timeout_ms });
    }
    return undefined;
  }

  /** 根据配置和当前环境选择网页正文 Provider。 */
  private resolve_document_provider(
    context: import("@downcity/city/plugin").PluginContext,
    config: WebPluginConfig,
  ): WebDocumentProvider | undefined {
    if (this.document_provider) return this.document_provider;
    const selected = config.document_provider ?? "fetch";
    if (selected === "disabled") return undefined;
    if (selected === "fetch") {
      return new FetchDocumentProvider({
        timeout_ms: config.timeout_ms,
        max_chars: config.max_observation_chars,
      });
    }
    const api_key = read_secret(
      config.firecrawl_api_key,
      context.workspace.env.FIRECRAWL_API_KEY,
    );
    return api_key
      ? new FirecrawlDocumentProvider({ api_key, timeout_ms: config.timeout_ms })
      : undefined;
  }

  /** 检查当前执行范围是否配置了至少一种 Web 能力。 */
  availability(
    context: import("@downcity/city/plugin").PluginContext,
  ): PluginAvailability {
    const config = this.resolve_config(context);
    const available = Boolean(this.resolve_search_provider(context, config)
      || this.resolve_document_provider(context, config)
      || this.browser_provider_factory
      || config.browser_provider !== "disabled");
    return {
      enabled: true,
      available,
      reasons: available ? [] : ["WebPlugin has no configured provider"],
    };
  }

  /** 给模型注入最小且与当前已配置能力一致的使用说明。 */
  system(context: import("@downcity/city/plugin").PluginContext): string {
    const config = this.resolve_config(context);
    const has_direct_web = Boolean(
      this.resolve_search_provider(context, config)
      || this.resolve_document_provider(context, config),
    );
    const has_browser = Boolean(
      this.browser_provider_factory || config.browser_provider !== "disabled",
    );
    return [
      "# Web Plugin",
      "",
      ...(has_direct_web
        ? ["Use direct search or document reading before starting a browser session."]
        : []),
      ...(has_browser
        ? [
            "Use browser actions only for dynamic pages, navigation, or interaction.",
            "Inspect the page, then use observation_generation and element refs for browser actions; use CSS selectors only for explicit deterministic automation.",
            "Do not perform consequential actions such as submitting, sending, purchasing, uploading, or deleting without host approval.",
            "Close every browser session created for the task when it is no longer needed.",
          ]
        : []),
    ].join("\n");
  }

  /** WebPlugin 结构化 actions。 */
  readonly actions = {
    [WEB_PLUGIN_ACTIONS.search]: create_action({
      description: "Search the web with the configured search provider.",
      input_schema: z.object({
        query: z.string().trim().min(1),
        limit: z.number().int().min(1).max(100).optional(),
        domains: z.array(z.string().trim().min(1)).max(50).optional(),
      }),
      examples: [{ title: "Search official sources", payload: { query: "Playwright CDP documentation", limit: 5 } }],
      execute: async ({ context, input }) => {
        const config = this.resolve_config(context);
        const search_provider = this.resolve_search_provider(context, config);
        if (!search_provider) {
          return failure_result("WebPlugin search provider is not configured");
        }
        try {
          const result = await search_provider.search(input as WebSearchInput);
          return { success: true, data: result, message: "web search completed" };
        } catch (error) {
          return failure_result(error);
        }
      },
    }),

    [WEB_PLUGIN_ACTIONS.open]: create_action({
      description: "Read a known URL with the configured document provider.",
      input_schema: z.object({ url: URL_SCHEMA, max_chars: MAX_CHARS_SCHEMA }),
      examples: [{ title: "Read official documentation", payload: { url: "https://playwright.dev/docs/api/class-playwright" } }],
      execute: async ({ context, input }) => {
        const config = this.resolve_config(context);
        const document_provider = this.resolve_document_provider(context, config);
        if (!document_provider) {
          return failure_result("WebPlugin document provider is not configured");
        }
        try {
          const result = await document_provider.open(input as WebOpenInput);
          return { success: true, data: result, message: "web document opened" };
        } catch (error) {
          return failure_result(error);
        }
      },
    }),

    [WEB_PLUGIN_ACTIONS.browser_create_session]: create_action({
      description: "Create a browser session with an optional initial URL.",
      input_schema: z.object({
        url: URL_SCHEMA.optional(),
        include_screenshot: z.boolean().optional(),
      }),
      examples: [{ title: "Open a page", payload: { url: "https://example.com" } }],
      execute: async ({ context, input }) => {
        const browser_provider = await this.ensure_browser_provider(context);
        if (!browser_provider) {
          return failure_result("WebPlugin browser provider is not configured");
        }
        try {
          const result = await browser_provider.create_session(
            input as BrowserCreateSessionInput,
          );
          return { success: true, data: result, message: "browser session created" };
        } catch (error) {
          return failure_result(error);
        }
      },
    }),

    [WEB_PLUGIN_ACTIONS.browser_observe]: create_action({
      description: "Observe the current browser page as text and an optional screenshot.",
      input_schema: z.object({
        session_id: SESSION_ID_SCHEMA,
        include_screenshot: z.boolean().optional(),
      }),
      execute: async ({ context, input }) => {
        const browser_provider = await this.ensure_browser_provider(context);
        if (!browser_provider) {
          return failure_result("WebPlugin browser provider is not configured");
        }
        try {
          const result = await browser_provider.observe(
            input as BrowserObserveInput,
          );
          return { success: true, data: result, message: "browser observed" };
        } catch (error) {
          return failure_result(error);
        }
      },
    }),

    [WEB_PLUGIN_ACTIONS.browser_act]: create_action({
      description: "Execute one deterministic browser action and return the resulting observation.",
      input_schema: z.object({
        session_id: SESSION_ID_SCHEMA,
        action: BROWSER_ACTION_SCHEMA,
        include_screenshot: z.boolean().optional(),
      }),
      examples: [{
        title: "Click an observed element",
        payload: {
          session_id: "session-id",
          action: { type: "click", ref: "e1", observation_generation: 1 },
        },
      }],
      execute: async ({ context, input }) => {
        const browser_provider = await this.ensure_browser_provider(context);
        if (!browser_provider) {
          return failure_result("WebPlugin browser provider is not configured");
        }
        try {
          const result = await browser_provider.act(input as BrowserActInput);
          return { success: true, data: result, message: "browser action completed" };
        } catch (error) {
          return failure_result(error);
        }
      },
    }),

    [WEB_PLUGIN_ACTIONS.browser_semantic_act]: create_action({
      description: "Execute one natural-language browser action through a semantic provider.",
      input_schema: z.object({
        session_id: SESSION_ID_SCHEMA,
        instruction: z.string().trim().min(1),
        include_screenshot: z.boolean().optional(),
      }),
      examples: [{
        title: "Use a semantic browser action",
        payload: {
          session_id: "session-id",
          instruction: "Click the sign in button",
        },
      }],
      execute: async ({ context, input }) => {
        const browser_provider = await this.ensure_browser_provider(context);
        if (!browser_provider?.semantic_act) {
          return failure_result(
            "WebPlugin semantic browser action provider is not configured",
          );
        }
        try {
          const result = await browser_provider.semantic_act(
            input as BrowserSemanticActInput,
          );
          return { success: true, data: result, message: "semantic browser action completed" };
        } catch (error) {
          return failure_result(error);
        }
      },
    }),

    [WEB_PLUGIN_ACTIONS.browser_extract]: create_action({
      description: "Extract text from the page body or a CSS selector.",
      input_schema: z.object({
        session_id: SESSION_ID_SCHEMA,
        selector: z.string().trim().min(1).optional(),
        max_chars: MAX_CHARS_SCHEMA,
      }),
      execute: async ({ context, input }) => {
        const browser_provider = await this.ensure_browser_provider(context);
        if (!browser_provider) {
          return failure_result("WebPlugin browser provider is not configured");
        }
        try {
          const result = await browser_provider.extract(
            input as BrowserExtractInput,
          );
          return { success: true, data: result, message: "browser content extracted" };
        } catch (error) {
          return failure_result(error);
        }
      },
    }),

    [WEB_PLUGIN_ACTIONS.browser_semantic_extract]: create_action({
      description: "Extract page content through a semantic provider.",
      input_schema: z.object({
        session_id: SESSION_ID_SCHEMA,
        instruction: z.string().trim().min(1),
        max_chars: MAX_CHARS_SCHEMA,
      }),
      execute: async ({ context, input }) => {
        const browser_provider = await this.ensure_browser_provider(context);
        if (!browser_provider?.semantic_extract) {
          return failure_result(
            "WebPlugin semantic browser extract provider is not configured",
          );
        }
        try {
          const result = await browser_provider.semantic_extract(
            input as BrowserSemanticExtractInput,
          );
          return { success: true, data: result, message: "semantic browser content extracted" };
        } catch (error) {
          return failure_result(error);
        }
      },
    }),

    [WEB_PLUGIN_ACTIONS.browser_close_session]: create_action({
      description: "Close a browser session and release its page resources.",
      input_schema: z.object({ session_id: SESSION_ID_SCHEMA }),
      execute: async ({ context, input }) => {
        const browser_provider = await this.ensure_browser_provider(context);
        if (!browser_provider) {
          return failure_result("WebPlugin browser provider is not configured");
        }
        try {
          await browser_provider.close_session(
            input as BrowserCloseSessionInput,
          );
          return {
            success: true,
            data: { session_id: input.session_id, closed: true },
            message: "browser session closed",
          };
        } catch (error) {
          return failure_result(error);
        }
      },
    }),
  } as unknown as Plugin["actions"];
}

/** 返回浏览器资源的 Agent 配置隔离键。 */
function web_provider_key(context: import("@downcity/city/plugin").PluginContext): string {
  return JSON.stringify([context.agent.id, context.workspace.id]);
}

/** 校验 WebPlugin 当前公开支持的内建浏览器类型。 */
function assert_supported_config(config: WebPluginConfig | undefined): void {
  if (config?.search_provider && !["auto", "tavily", "exa", "disabled"].includes(config.search_provider)) {
    throw new TypeError(`Unsupported Web search provider: ${config.search_provider}`);
  }
  if (config?.document_provider && !["fetch", "firecrawl", "disabled"].includes(config.document_provider)) {
    throw new TypeError(`Unsupported Web document provider: ${config.document_provider}`);
  }
  if (config?.browser_provider && !["local", "cdp", "disabled"].includes(config.browser_provider)) {
    throw new TypeError(`Unsupported Web browser provider: ${config.browser_provider}`);
  }
}

/** 根据当前配置选择内建浏览器工厂。 */
function resolve_builtin_browser_factory(
  config: WebPluginConfig,
): BrowserProviderFactory | undefined {
  if (config.browser_provider === "disabled") return undefined;
  return config.browser_provider === "cdp"
    ? create_playwright_browser_provider
    : create_local_browser_provider;
}

/** 根据当前作用域配置创建 Playwright/CDP Provider。 */
function create_playwright_browser_provider(
  scope: import("@/web/types/WebPlugin.js").BrowserProviderScope,
): BrowserProvider {
  const config = scope.config;
  if (!config.cdp_url) {
    throw new Error("WebPlugin Playwright browser requires cdp_url");
  }
  return new PlaywrightBrowserProvider({
    cdp_url: config.cdp_url,
    ...(config.default_url ? { default_url: config.default_url } : {}),
    ...(config.timeout_ms !== undefined ? { timeout_ms: config.timeout_ms } : {}),
    ...(config.max_observation_chars !== undefined
      ? { max_observation_chars: config.max_observation_chars }
      : {}),
  });
}

/** 根据当前作用域配置创建 WebPlugin 自有本地浏览器。 */
function create_local_browser_provider(
  scope: import("@/web/types/WebPlugin.js").BrowserProviderScope,
): BrowserProvider {
  const config = scope.config;
  return new LocalBrowserProvider({
    profile_path: `${scope.data_path}/browser/${Buffer.from(scope.workspace_id).toString("base64url")}`,
    ...(config.browser_executable_path
      ? { executable_path: config.browser_executable_path }
      : {}),
    ...(config.default_url ? { default_url: config.default_url } : {}),
    ...(config.timeout_ms !== undefined ? { timeout_ms: config.timeout_ms } : {}),
    ...(config.max_observation_chars !== undefined
      ? { max_observation_chars: config.max_observation_chars }
      : {}),
  });
}

/** 配置值优先于环境变量解析 Provider 密钥。 */
function read_secret(config_value: string | undefined, env_value: string | undefined): string {
  return String(config_value || env_value || "").trim();
}

/** 从 Promise 批量执行结果中提取全部失败原因。 */
function rejected_reasons(results: PromiseSettledResult<unknown>[]): unknown[] {
  return results
    .filter((result): result is PromiseRejectedResult => result.status === "rejected")
    .map((result) => result.reason);
}
