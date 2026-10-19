/**
 * Web Power 工作区 Renderer 的共享常量与路由工具。
 *
 * 关键点（中文）
 * - 侧栏按能力分组：能力是可展开的分支，Provider 是它下面的叶子。
 * - 「关闭」不是一种 Provider，因此不在 Provider 列表里；开关属于能力本身。
 * - 配置是 Power 级的单一存储，route 只保存当前能力，不携带执行范围。
 * - Sidebar 与 Mainview 共享同一份能力与 Provider 常量，避免两处各写一份选项。
 */

import type { PowerJsonObject, PowerJsonValue } from "@downcity/city/power";
import type {
  WebCapability,
  WebMainviewCapabilityStatus,
  WebProviderCapability,
} from "@/web/types/WebMainview.js";
import type { WebConfigPatch, WebConfigView } from "@/web/types/WebPowerConfig.js";

/** 一个可选的 Provider。 */
export interface WebProviderOption {
  /** 稳定值，直接写入配置。 */
  readonly value: string;

  /** 用户可见名称。 */
  readonly label: string;

  /**
   * 该 Provider 需要哪个已保存的配置才能工作；不需要凭据时为空。
   *
   * 用声明式的「需要什么」而不是回调：这样「能不能用」只有一个可读的来源，
   * 界面与测试都不需要重算一遍规则。
   */
  readonly requires: readonly WebConfigRequirement[];
}

/** Provider 运行所需的配置项。 */
export type WebConfigRequirement =
  | "tavily_api_key"
  | "exa_api_key"
  | "deepseek_api_key"
  | "firecrawl_api_key"
  | "cdp_url";

/** 判断一个配置项是否已经具备。 */
function has_requirement(config: WebConfigView, requirement: WebConfigRequirement): boolean {
  if (requirement === "tavily_api_key") return config.tavily_api_key_configured;
  if (requirement === "exa_api_key") return config.exa_api_key_configured;
  if (requirement === "deepseek_api_key") return config.deepseek_api_key_configured;
  if (requirement === "firecrawl_api_key") return config.firecrawl_api_key_configured;
  return config.cdp_url.trim().length > 0;
}

/**
 * 判断一个 Provider 是否已具备运行条件。
 *
 * 搜索的 `auto` 例外：按 Tavily、Exa、DeepSeek 的顺序选择，任意一个有 Key 即可。
 */
export function is_provider_ready(
  config: WebConfigView,
  capability: WebConfiguredCapability,
  provider_value: string,
): boolean {
  if (provider_value === "auto") {
    return config.tavily_api_key_configured || config.exa_api_key_configured || config.deepseek_api_key_configured;
  }
  const option = PROVIDER_OPTIONS[capability].find((item) => item.value === provider_value);
  if (!option) return false;
  return option.requires.every((requirement) => has_requirement(config, requirement));
}

/** 侧栏能力项的展示顺序与名称。 */
export const CAPABILITY_ORDER: ReadonlyArray<{
  /** 能力稳定键，同时是 route 的取值。 */
  readonly key: WebCapability;
  /** 用户可见名称。 */
  readonly label: string;
}> = [
  { key: "search", label: "搜索" },
  { key: "document", label: "网页读取" },
  { key: "browser", label: "浏览器" },
  { key: "general", label: "通用" },
];

/** 有 Provider 子项的能力。 */
export type WebConfiguredCapability = WebProviderCapability;

/** 带 Provider 子项的能力，按侧栏顺序。 */
export const CONFIGURED_CAPABILITIES = CAPABILITY_ORDER.filter(
  (item): item is { key: WebConfiguredCapability; label: string } => item.key !== "general",
);

/** 读取一个能力的用户可见名称。 */
export function capability_label(capability: WebCapability): string {
  return CAPABILITY_ORDER.find((item) => item.key === capability)?.label ?? capability;
}

/** 读取某个 Provider 值的用户可见名称。 */
export function provider_label(
  config: WebConfigView,
  capability: WebConfiguredCapability,
): string {
  const value = read_selected_provider(config, capability);
  return PROVIDER_OPTIONS[capability].find((option) => option.value === value)?.label ?? value;
}

/** 每个能力对应的 Provider 配置字段。 */
export const PROVIDER_FIELD: Record<
  WebConfiguredCapability,
  "search_provider" | "document_provider" | "browser_provider"
> = {
  search: "search_provider",
  document: "document_provider",
  browser: "browser_provider",
};

/**
 * 每个能力可选的 Provider。
 *
 * 不含「关闭」：关闭表达的是「这个能力用不用」，与「用哪一家」是两件事，
 * 因此由能力页上的开关承担，而不是和具体 Provider 并列成第三个选项。
 */
export const PROVIDER_OPTIONS: Record<
  WebConfiguredCapability,
  ReadonlyArray<WebProviderOption>
> = {
  search: [
    { value: "auto", label: "Auto", requires: [] },
    { value: "tavily", label: "Tavily", requires: ["tavily_api_key"] },
    { value: "exa", label: "Exa", requires: ["exa_api_key"] },
    { value: "deepseek", label: "DeepSeek", requires: ["deepseek_api_key"] },
  ],
  document: [
    { value: "fetch", label: "Fetch", requires: [] },
    { value: "firecrawl", label: "Firecrawl", requires: ["firecrawl_api_key"] },
    { value: "deepseek", label: "DeepSeek", requires: ["deepseek_api_key"] },
  ],
  browser: [
    { value: "local", label: "Local Chrome", requires: [] },
    { value: "cdp", label: "Remote CDP", requires: ["cdp_url"] },
  ],
};

/**
 * 重新开启一个能力时使用的 Provider。
 *
 * 关闭状态只保存 `disabled`，不另存「上次用哪家」；重新开启回到该能力的默认选择，
 * 而不是回到可能已经不存在的旧值。
 */
export const DEFAULT_PROVIDER: Record<WebConfiguredCapability, string> = {
  search: "auto",
  document: "fetch",
  browser: "local",
};

/** 未显式指定能力时展示搜索。 */
const DEFAULT_CAPABILITY: WebCapability = "search";

/** 构造 Web 工作区 route。 */
export function web_route(capability: WebCapability = DEFAULT_CAPABILITY): PowerJsonObject {
  return { capability };
}

/** 从宿主 JSON route 中读取当前能力；未知值回落到默认能力。 */
export function read_capability(value: unknown): WebCapability {
  return CAPABILITY_ORDER.find((item) => item.key === value)?.key ?? DEFAULT_CAPABILITY;
}

/** 读取某个能力当前选中的 Provider 值。 */
export function read_selected_provider(
  config: WebConfigView,
  capability: WebConfiguredCapability,
): string {
  return config[PROVIDER_FIELD[capability]];
}

/** 该能力当前是否开启。 */
export function is_capability_enabled(
  config: WebConfigView,
  capability: WebConfiguredCapability,
): boolean {
  return read_selected_provider(config, capability) !== "disabled";
}

/** 侧栏分支行右侧要展示的一个 tag。 */
export interface WebCapabilityTag {
  /** 用户可见文字。 */
  readonly label: string;

  /** 语义，用于取色。 */
  readonly tone: "warning" | "muted";
}

/** 侧栏分支行右侧要展示的一个 tag。 */
export interface WebCapabilityTag {
  /** 用户可见文字。 */
  readonly label: string;

  /** 语义，用于取色。 */
  readonly tone: "warning" | "muted";
}

/**
 * 侧栏分支行右侧的 tag：回答「当前是什么模式」。
 *
 * 三种情况各一个词，不再把 Provider 名和状态词混在同一列里——
 * 那种写法需要用户自己分辨哪个是名字、哪个是提醒。
 */
export function capability_tag(
  config: WebConfigView,
  capability: WebConfiguredCapability,
  available: boolean,
): WebCapabilityTag {
  if (!is_capability_enabled(config, capability)) return { label: "已关闭", tone: "muted" };
  if (!available) return { label: "待配置", tone: "warning" };
  return { label: provider_label(config, capability), tone: "muted" };
}

/** 返回能力当前的可用性或选择说明。 */
export function capability_description(capability: WebMainviewCapabilityStatus): string {
  return capability.available ? capability.provider : capability.note;
}

/** 把未知失败转换为用户可见消息。 */
export function to_error_message(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason);
}

/**
 * 把配置增量收敛到 Power JSON 边界。
 *
 * 增量里的可选字段允许 `undefined`（“本次不改这个字段”），而 `PowerJsonValue` 不含
 * `undefined`——两者语义不同，不能靠类型断言抹平。这里显式丢掉未设置的字段，
 * 只把本次真正要改的字段交给宿主。
 */
export function to_config_patch_json(patch: WebConfigPatch): PowerJsonObject {
  const result: PowerJsonObject = {};
  for (const [key, value] of Object.entries(patch)) {
    if (value !== undefined) result[key] = value as PowerJsonValue;
  }
  return result;
}
