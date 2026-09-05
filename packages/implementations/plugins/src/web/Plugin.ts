/**
 * WebPlugin：provider-neutral 的联网与浏览器能力边界。
 *
 * 关键点（中文）
 * - 同一个 Plugin 实例根据 Agent/Workspace Context 管理隔离的浏览器 provider。
 * - 搜索、文档读取与浏览器 session 是三个独立能力。
 * - 浏览器长期资源由 provider 拥有，并在 Plugin lifecycle.stop 时统一释放。
 */

import { Plugin, create_action } from "@downcity/city/plugin";
import type { PluginJsonObject, PluginActionResult } from "@downcity/city/plugin";
import { z } from "zod";
import type {
  BrowserActInput,
  BrowserCloseSessionInput,
  BrowserCreateSessionInput,
  BrowserExtractInput,
  BrowserObserveInput,
  BrowserProvider,
  BrowserSemanticActInput,
  BrowserSemanticExtractInput,
  WebPluginOptions,
} from "@/web/types/WebPlugin.js";
import { WEB_PLUGIN_ACTIONS } from "@/web/types/WebPlugin.js";
import { PlaywrightBrowserProvider } from "@/web/providers/PlaywrightBrowserProvider.js";

const URL_SCHEMA = z.string().url();
const SESSION_ID_SCHEMA = z.string().trim().min(1);
const MAX_CHARS_SCHEMA = z.number().int().min(1).max(100_000).optional();

const BROWSER_ACTION_SCHEMA = z.discriminatedUnion("type", [
  z.object({ type: z.literal("goto"), url: URL_SCHEMA }),
  z.object({ type: z.literal("click"), selector: z.string().trim().min(1) }),
  z.object({
    type: z.literal("fill"),
    selector: z.string().trim().min(1),
    value: z.string(),
  }),
  z.object({
    type: z.literal("press"),
    selector: z.string().trim().min(1),
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

  /** 构造时显式配置；其优先级高于 City 作用域配置。 */
  private readonly options: WebPluginOptions;

  /** 按 Agent/Workspace 作用域持有的浏览器 provider。 */
  private readonly browser_providers = new Map<string, BrowserProvider>();

  constructor(options: WebPluginOptions = {}) {
    super();
    if (options.browser && options.browser !== "playwright") {
      throw new TypeError(`Unsupported Web browser provider: ${options.browser}`);
    }
    this.options = { ...options };
  }

  /** City 释放作用域或停止 Plugin 时关闭对应浏览器资源。 */
  readonly lifecycle = {
    connect: async (context: import("@downcity/city/plugin").PluginContext) => {
      this.ensure_browser_provider(context);
    },
    disconnect: async (context: import("@downcity/city/plugin").PluginContext) => {
      await this.dispose_browser_provider(web_scope_key(context));
    },
    stop: async () => {
      await Promise.all([...this.browser_providers.keys()].map(async (scope_key) => {
        await this.dispose_browser_provider(scope_key);
      }));
    },
  };

  /** 返回当前作用域配置的浏览器 provider。 */
  private ensure_browser_provider(
    context: import("@downcity/city/plugin").PluginContext,
  ): BrowserProvider | undefined {
    const scope_key = web_scope_key(context);
    const existing = this.browser_providers.get(scope_key);
    if (existing) return existing;
    const options = { ...context.config, ...this.options } as WebPluginOptions;
    if (options.browser && options.browser !== "playwright") {
      throw new TypeError(`Unsupported Web browser provider: ${options.browser}`);
    }
    if (!options.cdp_url) return undefined;
    const provider = new PlaywrightBrowserProvider({
      cdp_url: options.cdp_url,
      ...(options.default_url ? { default_url: options.default_url } : {}),
      ...(options.timeout_ms !== undefined ? { timeout_ms: options.timeout_ms } : {}),
      ...(options.max_observation_chars !== undefined
        ? { max_observation_chars: options.max_observation_chars }
        : {}),
    });
    this.browser_providers.set(scope_key, provider);
    return provider;
  }

  /** 关闭并移除一个作用域的浏览器 provider。 */
  private async dispose_browser_provider(scope_key: string): Promise<void> {
    const provider = this.browser_providers.get(scope_key);
    if (!provider) return;
    this.browser_providers.delete(scope_key);
    await provider.dispose();
  }

  /** 给模型注入最小且与实际 actions 一致的使用说明。 */
  system(): string {
    return [
      "# Web Plugin",
      "",
      "Use direct search or document reading before starting a browser session.",
      "Use browser actions only for dynamic pages, navigation, or interaction.",
      "Browser actions are deterministic CSS-selector operations; inspect the page before acting.",
      "Do not perform consequential actions such as submitting, sending, purchasing, uploading, or deleting without host approval.",
      "Close every browser session created for the task when it is no longer needed.",
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
        if (!context.agent.web) {
          return failure_result("WebPlugin search provider is not configured");
        }
        try {
          const result = await context.agent.web.search(input as PluginJsonObject);
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
        if (!context.agent.web) {
          return failure_result("WebPlugin document provider is not configured");
        }
        try {
          const result = await context.agent.web.open(input as PluginJsonObject);
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
        const browser_provider = this.ensure_browser_provider(context);
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
        const browser_provider = this.ensure_browser_provider(context);
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
      examples: [{ title: "Click a link", payload: { session_id: "session-id", action: { type: "click", selector: "a" } } }],
      execute: async ({ context, input }) => {
        const browser_provider = this.ensure_browser_provider(context);
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
        const browser_provider = this.ensure_browser_provider(context);
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
        const browser_provider = this.ensure_browser_provider(context);
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
        const browser_provider = this.ensure_browser_provider(context);
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
        const browser_provider = this.ensure_browser_provider(context);
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

/** 返回浏览器资源的 Agent/Workspace 隔离键。 */
function web_scope_key(context: import("@downcity/city/plugin").PluginContext): string {
  return `${context.agent.id}\u0000${context.workspace.id}`;
}
