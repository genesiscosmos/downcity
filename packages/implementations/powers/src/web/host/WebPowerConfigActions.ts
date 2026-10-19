/**
 * Web Power 的配置 actions。
 *
 * 关键点（中文）
 * - 配置属于工作区：这些 action 与状态 action 共用同一个 host action 通道。
 * - API Key 只允许写入持久配置；读取与测试结果均不返回明文。
 * - `web.config.save` 接受字段级增量：只应用输入里出现的字段，未出现的保持原值，
 *   因此界面可以按能力分别保存，互不覆盖。
 * - 保存成功后释放按旧配置创建的浏览器 Provider，下一次调用再按新配置惰性重建。
 */

import type {
  PowerJsonObject,
  PowerJsonValue,
  PowerLifecycleContext,
} from "@downcity/city/power";
import type { WebPowerConfig } from "@/web/types/WebPower.js";
import type {
  WebConfigPatch,
  WebConfigTestInput,
  WebConfigTestResult,
  WebConfigView,
  WebCredentialTarget,
} from "@/web/types/WebPowerConfig.js";

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_OBSERVATION_CHARS = 12_000;

/** Web 配置 actions 的资源回调。 */
export interface WebConfigActionOptions {
  /** 配置保存后释放旧 Provider。 */
  after_save(): Promise<void>;
}

/** 注册 Web Power 的配置 actions。 */
export function register_web_power_config_actions(
  context: PowerLifecycleContext,
  options: WebConfigActionOptions,
): void {
  context.power.action({
    id: "web.config.read",
    run: async () => public_config(context.config.get()),
  });
  context.power.action({
    id: "web.config.save",
    run: async (input) => {
      const next = apply_config_patch(input, context.config.get());
      await context.config.set(next as unknown as PowerJsonObject);
      await options.after_save();
      return public_config(next as unknown as PowerJsonObject);
    },
  });
  context.power.action({
    id: "web.config.test",
    run: async (input) => as_json(await test_capability(context, input)),
  });
  context.power.action({
    id: "web.config.reveal_file",
    run: async () => {
      const file_path = context.config.path;
      if (!file_path) return { success: false, message: "当前配置没有对应的文件。" };
      await context.system.show_item_in_folder({ path: file_path });
      return { success: true, message: "已在文件管理器中打开配置目录。" };
    },
  });
  context.power.action({
    id: "web.config.open_console",
    run: async (input) => {
      // 地址由凭据项映射得出，不接受渲染层传入的任意 URL：
      // 否则这个动作就变成了一个可以打开任何地址的通用入口。
      const target = read_credential_target(input);
      const url = CREDENTIAL_CONSOLE_URLS[target];
      try {
        await context.system.open_external({ url });
        return { success: true, message: `已在浏览器中打开 ${target} 的控制台。` };
      } catch (error) {
        return {
          success: false,
          message: error instanceof Error ? error.message : String(error),
        };
      }
    },
  });
}

/** 凭据项对应的服务商控制台地址。 */
const CREDENTIAL_CONSOLE_URLS: Record<WebCredentialTarget, string> = {
  tavily_api_key: "https://app.tavily.com/home",
  exa_api_key: "https://dashboard.exa.ai/api-keys",
  deepseek_api_key: "https://platform.deepseek.com/api_keys",
  firecrawl_api_key: "https://www.firecrawl.dev/app/api-keys",
  cdp_url: "https://playwright.dev/docs/browser-contexts",
};

/** 读取要打开控制台的凭据项。 */
function read_credential_target(input: PowerJsonValue | undefined): WebCredentialTarget {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("Invalid console target input");
  }
  const target = (input as PowerJsonObject).target;
  if (typeof target === "string" && target in CREDENTIAL_CONSOLE_URLS) {
    return target as WebCredentialTarget;
  }
  throw new Error(`Unknown credential target: ${String(target)}`);
}

/** 把持久配置转换为不含凭据的配置视图。 */
export function public_config(source: PowerJsonObject): WebConfigView {
  const config = source as WebPowerConfig;
  return {
    search_provider: read_search_provider(config.search_provider),
    document_provider: read_document_provider(config.document_provider),
    browser_provider: read_browser_provider(config.browser_provider),
    tavily_api_key_configured: Boolean(read_string(config.tavily_api_key)),
    exa_api_key_configured: Boolean(read_string(config.exa_api_key)),
    deepseek_api_key_configured: Boolean(read_string(config.deepseek_api_key)),
    firecrawl_api_key_configured: Boolean(read_string(config.firecrawl_api_key)),
    cdp_url: read_string(config.cdp_url),
    browser_executable_path: read_string(config.browser_executable_path),
    default_url: read_string(config.default_url),
    timeout_ms: read_number(config.timeout_ms, DEFAULT_TIMEOUT_MS, 1_000, 60_000),
    max_observation_chars: read_number(
      config.max_observation_chars,
      DEFAULT_MAX_OBSERVATION_CHARS,
      1,
      100_000,
    ),
  };
}

/**
 * 在现有配置上应用一次字段级增量。
 *
 * 只处理输入里实际出现的字段：未出现的字段保留原值。这让界面可以一次只提交一个能力
 * 的改动，而不必先读回完整配置再整体覆盖。
 */
export function apply_config_patch(
  input: PowerJsonValue | undefined,
  current_source: PowerJsonObject,
): WebPowerConfig {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("Web Power config patch must be an object");
  }
  const patch = input as unknown as WebConfigPatch;
  const current = current_source as WebPowerConfig;
  const result: WebPowerConfig = { ...current };

  if (patch.search_provider !== undefined) {
    result.search_provider = read_search_provider(patch.search_provider);
  }
  if (patch.document_provider !== undefined) {
    result.document_provider = read_document_provider(patch.document_provider);
  }
  if (patch.browser_provider !== undefined) {
    result.browser_provider = read_browser_provider(patch.browser_provider);
  }
  if (patch.timeout_ms !== undefined) {
    result.timeout_ms = read_number(patch.timeout_ms, DEFAULT_TIMEOUT_MS, 1_000, 60_000);
  }
  if (patch.max_observation_chars !== undefined) {
    result.max_observation_chars = read_number(
      patch.max_observation_chars,
      DEFAULT_MAX_OBSERVATION_CHARS,
      1,
      100_000,
    );
  }
  if (patch.cdp_url !== undefined) assign_optional(result, "cdp_url", patch.cdp_url);
  if (patch.browser_executable_path !== undefined) {
    assign_optional(result, "browser_executable_path", patch.browser_executable_path);
  }
  if (patch.default_url !== undefined) assign_optional(result, "default_url", patch.default_url);
  assign_secret(result, "tavily_api_key", patch.tavily_api_key, patch.clear_tavily_api_key, current);
  assign_secret(result, "exa_api_key", patch.exa_api_key, patch.clear_exa_api_key, current);
  assign_secret(result, "deepseek_api_key", patch.deepseek_api_key, patch.clear_deepseek_api_key, current);
  assign_secret(result, "firecrawl_api_key", patch.firecrawl_api_key, patch.clear_firecrawl_api_key, current);
  return result;
}

/**
 * 测试已保存能力。
 *
 * 配置是全局的，但解析 Provider 需要一个真实执行范围（Workspace env 可能提供 API Key），
 * 因此这里自动选用宿主登记的第一个 Agent 与 Workspace，不需要用户先选范围。
 */
async function test_capability(
  context: PowerLifecycleContext,
  input: PowerJsonValue | undefined,
): Promise<WebConfigTestResult> {
  const capability = read_test_capability(input);
  const [agent] = await context.system.list_agents();
  const [workspace] = await context.system.list_workspaces();
  if (!agent || !workspace) {
    return { success: false, message: "请先创建至少一个 Agent 和 Workspace，再测试 Web 能力。" };
  }
  const action_id = capability === "search"
    ? "search"
    : capability === "document" ? "open" : "browser_create_session";
  const action_input: PowerJsonObject = capability === "search"
    ? { query: "Downcity official documentation", limit: 1 }
    : capability === "document"
      ? { url: "https://example.com", max_chars: 1_000 }
      : {};
  try {
    const result = await context.system.invoke_agent_power({
      agent_id: agent.agent_id,
      workspace_id: workspace.workspace_id,
      power_id: context.power.id,
      action_id,
      input: action_input,
    }) as PowerJsonObject;
    if (result.success !== true) {
      return { success: false, message: String(result.error || result.message || "能力测试失败") };
    }
    if (capability === "browser") {
      const data = result.data as PowerJsonObject | undefined;
      const session_id = typeof data?.session_id === "string" ? data.session_id : "";
      if (session_id) {
        await context.system.invoke_agent_power({
          agent_id: agent.agent_id,
          workspace_id: workspace.workspace_id,
          power_id: context.power.id,
          action_id: "browser_close_session",
          input: { session_id },
        });
      }
    }
    return { success: true, message: "连接测试成功。" };
  } catch (error) {
    return { success: false, message: error instanceof Error ? error.message : String(error) };
  }
}

/** 读取测试能力枚举。 */
function read_test_capability(input: PowerJsonValue | undefined): WebConfigTestInput["capability"] {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("Invalid test input");
  const capability = (input as PowerJsonObject).capability;
  if (capability === "search" || capability === "document" || capability === "browser") return capability;
  throw new Error("Invalid Web capability");
}

/** 读取搜索 Provider 枚举。 */
function read_search_provider(value: unknown): NonNullable<WebPowerConfig["search_provider"]> {
  return value === "tavily" || value === "exa" || value === "deepseek" || value === "disabled" ? value : "auto";
}

/** 读取文档 Provider 枚举。 */
function read_document_provider(value: unknown): NonNullable<WebPowerConfig["document_provider"]> {
  return value === "firecrawl" || value === "deepseek" || value === "disabled" ? value : "fetch";
}

/** 读取浏览器 Provider 枚举。 */
function read_browser_provider(value: unknown): NonNullable<WebPowerConfig["browser_provider"]> {
  return value === "cdp" || value === "disabled" ? value : "local";
}

/** 读取经过空白裁剪的字符串。 */
function read_string(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/** 读取并约束整数。 */
function read_number(value: unknown, fallback: number, minimum: number, maximum: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.min(maximum, Math.max(minimum, Math.floor(value)));
}

/** 写入非空可选字符串；空值表示清除该字段。 */
function assign_optional<TKey extends "cdp_url" | "browser_executable_path" | "default_url">(
  target: WebPowerConfig,
  key: TKey,
  value: unknown,
): void {
  const normalized = read_string(value);
  if (normalized) target[key] = normalized;
  else delete target[key];
}

/** 按新值、显式清除、保留旧值的顺序处理密钥。 */
function assign_secret(
  target: WebPowerConfig,
  key: "tavily_api_key" | "exa_api_key" | "deepseek_api_key" | "firecrawl_api_key",
  value: unknown,
  clear: unknown,
  current: WebPowerConfig,
): void {
  const next = read_string(value);
  if (next) target[key] = next;
  else if (clear === true) delete target[key];
  else {
    const existing = read_string(current[key]);
    if (existing) target[key] = existing;
    else delete target[key];
  }
}

/** 把结构化协议显式收敛到 Power JSON 边界。 */
function as_json(value: unknown): PowerJsonValue {
  return value as PowerJsonValue;
}
