/**
 * Web Power 唯一配置的宿主 actions。
 *
 * 关键点（中文）：API Key 只允许写入持久配置；读取与测试结果均不返回明文。
 */

import type {
  PowerJsonObject,
  PowerJsonValue,
  PowerLifecycleContext,
} from "@downcity/city/power";
import type { WebPowerConfig } from "@/web/types/WebPower.js";
import type {
  WebPowerConfigSaveInput,
  WebPowerConfigTestInput,
  WebPowerConfigTestResult,
  WebPowerConfigView,
} from "@/web/types/WebPowerSettings.js";

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_OBSERVATION_CHARS = 12_000;

/** Web 配置 actions 的资源回调。 */
export interface WebPowerConfigActionOptions {
  /** 配置保存后释放旧 Provider。 */
  after_save(): Promise<void>;
}

/** 注册 Web Power 的脱敏配置与能力测试 actions。 */
export function register_web_power_config_actions(
  context: PowerLifecycleContext,
  options: WebPowerConfigActionOptions,
): void {
  context.power.config_action({
    id: "config.read",
    run: async (_input, action_context) => public_config(action_context.config.get()),
  });
  context.power.config_action({
    id: "config.save",
    run: async (input, action_context) => {
      const next = normalize_config(input, action_context.config.get());
      await action_context.config.set(next as unknown as PowerJsonObject);
      await options.after_save();
      return public_config(next as unknown as PowerJsonObject);
    },
  });
  context.power.config_action({
    id: "config.test",
    run: async (input) => await test_capability(context, input),
  });
}

/** 把持久配置转换为不含凭据的 Renderer 视图。 */
export function public_config(source: PowerJsonObject): WebPowerConfigView {
  const config = source as WebPowerConfig;
  return {
    search_provider: read_search_provider(config.search_provider),
    document_provider: read_document_provider(config.document_provider),
    browser_provider: read_browser_provider(config.browser_provider),
    tavily_api_key_configured: Boolean(read_string(config.tavily_api_key)),
    exa_api_key_configured: Boolean(read_string(config.exa_api_key)),
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

/** 校验、规范化配置并按明确语义更新 Key。 */
export function normalize_config(
  input: PowerJsonValue | undefined,
  current_source: PowerJsonObject,
): WebPowerConfig {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("Web Power config must be an object");
  }
  const source = input as unknown as WebPowerConfigSaveInput;
  const current = current_source as WebPowerConfig;
  const result: WebPowerConfig = {
    search_provider: read_search_provider(source.search_provider),
    document_provider: read_document_provider(source.document_provider),
    browser_provider: read_browser_provider(source.browser_provider),
    timeout_ms: read_number(source.timeout_ms, DEFAULT_TIMEOUT_MS, 1_000, 60_000),
    max_observation_chars: read_number(
      source.max_observation_chars,
      DEFAULT_MAX_OBSERVATION_CHARS,
      1,
      100_000,
    ),
  };
  assign_optional(result, "cdp_url", source.cdp_url);
  assign_optional(result, "browser_executable_path", source.browser_executable_path);
  assign_optional(result, "default_url", source.default_url);
  assign_secret(result, "tavily_api_key", source.tavily_api_key, source.clear_tavily_api_key, current);
  assign_secret(result, "exa_api_key", source.exa_api_key, source.clear_exa_api_key, current);
  assign_secret(result, "firecrawl_api_key", source.firecrawl_api_key, source.clear_firecrawl_api_key, current);
  if (result.browser_provider === "cdp" && !result.cdp_url) {
    throw new Error("CDP endpoint is required when browser provider is CDP");
  }
  return result;
}

/** 通过一个真实 Agent/Workspace 执行范围测试已保存能力。 */
async function test_capability(
  context: PowerLifecycleContext,
  input: PowerJsonValue | undefined,
): Promise<WebPowerConfigTestResult> {
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
function read_test_capability(input: PowerJsonValue | undefined): WebPowerConfigTestInput["capability"] {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("Invalid test input");
  const capability = (input as PowerJsonObject).capability;
  if (capability === "search" || capability === "document" || capability === "browser") return capability;
  throw new Error("Invalid Web capability");
}

/** 读取搜索 Provider 枚举。 */
function read_search_provider(value: unknown): NonNullable<WebPowerConfig["search_provider"]> {
  return value === "tavily" || value === "exa" || value === "disabled" ? value : "auto";
}

/** 读取文档 Provider 枚举。 */
function read_document_provider(value: unknown): NonNullable<WebPowerConfig["document_provider"]> {
  return value === "firecrawl" || value === "disabled" ? value : "fetch";
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

/** 写入非空可选字符串。 */
function assign_optional<TKey extends "cdp_url" | "browser_executable_path" | "default_url">(
  target: WebPowerConfig,
  key: TKey,
  value: unknown,
): void {
  const normalized = read_string(value);
  if (normalized) target[key] = normalized;
}

/** 按新值、显式清除、保留旧值的顺序处理密钥。 */
function assign_secret(
  target: WebPowerConfig,
  key: "tavily_api_key" | "exa_api_key" | "firecrawl_api_key",
  value: unknown,
  clear: unknown,
  current: WebPowerConfig,
): void {
  const next = read_string(value);
  if (next) target[key] = next;
  else if (clear !== true) {
    const existing = read_string(current[key]);
    if (existing) target[key] = existing;
  }
}
