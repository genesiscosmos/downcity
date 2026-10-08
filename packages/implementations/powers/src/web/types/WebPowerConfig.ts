/**
 * Web Power 配置协议：配置视图、字段级增量与配置动作之间的可序列化契约。
 *
 * 关键点（中文）
 * - 配置是 Power 级的单一存储，与 Agent / Workspace 无关，因此协议里没有执行范围。
 * - 配置按能力组织：Provider 选择与它自己的参数落在同一个能力分组里。
 * - 已保存的 API Key 永不进入本协议，只出现「是否已配置」。
 * - 保存是字段级增量更新：只应用输入里出现的字段，未出现的字段保持原值，
 *   因此侧栏改 Provider 不会覆盖界面上其它尚未保存的输入。
 */

import type { PowerJsonObject } from "@downcity/city/power";
import type { WebPowerConfig } from "@/web/types/WebPower.js";

/** 配置视图：不含凭据的当前配置。 */
export interface WebConfigView extends PowerJsonObject {
  /** 搜索 Provider。 */
  search_provider: NonNullable<WebPowerConfig["search_provider"]>;
  /** 文档 Provider。 */
  document_provider: NonNullable<WebPowerConfig["document_provider"]>;
  /** 浏览器 Provider。 */
  browser_provider: NonNullable<WebPowerConfig["browser_provider"]>;
  /** Tavily Key 是否已保存。 */
  tavily_api_key_configured: boolean;
  /** Exa Key 是否已保存。 */
  exa_api_key_configured: boolean;
  /** Firecrawl Key 是否已保存。 */
  firecrawl_api_key_configured: boolean;
  /** 外部 CDP 地址。 */
  cdp_url: string;
  /** 可选本地浏览器路径。 */
  browser_executable_path: string;
  /** 新 Session 默认 URL。 */
  default_url: string;
  /** 网络与浏览器操作超时。 */
  timeout_ms: number;
  /** 页面观察字符上限。 */
  max_observation_chars: number;
}

/**
 * 配置增量输入：只包含本次要改动的字段。
 *
 * 不继承 `PowerJsonObject`：可选字段允许 `undefined`，而 JSON 对象索引签名不允许
 * `undefined`；宿主 action 入口会在运行时校验并收敛到 JSON 边界。
 */
export interface WebConfigPatch {
  /** 新的搜索 Provider。 */
  search_provider?: NonNullable<WebPowerConfig["search_provider"]>;
  /** 新的文档 Provider。 */
  document_provider?: NonNullable<WebPowerConfig["document_provider"]>;
  /** 新的浏览器 Provider。 */
  browser_provider?: NonNullable<WebPowerConfig["browser_provider"]>;
  /** 新 Tavily Key；空字符串表示保留已有 Key。 */
  tavily_api_key?: string;
  /** 是否删除 Tavily Key。 */
  clear_tavily_api_key?: boolean;
  /** 新 Exa Key；空字符串表示保留已有 Key。 */
  exa_api_key?: string;
  /** 是否删除 Exa Key。 */
  clear_exa_api_key?: boolean;
  /** 新 Firecrawl Key；空字符串表示保留已有 Key。 */
  firecrawl_api_key?: string;
  /** 是否删除 Firecrawl Key。 */
  clear_firecrawl_api_key?: boolean;
  /** 外部 CDP 地址；空字符串表示清除。 */
  cdp_url?: string;
  /** 本地浏览器路径；空字符串表示恢复自动发现。 */
  browser_executable_path?: string;
  /** 新 Session 默认 URL；空字符串表示清除。 */
  default_url?: string;
  /** 网络与浏览器操作超时。 */
  timeout_ms?: number;
  /** 页面观察字符上限。 */
  max_observation_chars?: number;
}

/** 能力测试输入。 */
export interface WebConfigTestInput extends PowerJsonObject {
  /** 要测试的能力类别。 */
  capability: "search" | "document" | "browser";
}

/** 能力测试结果。 */
export interface WebConfigTestResult extends PowerJsonObject {
  /** 测试是否成功。 */
  success: boolean;
  /** 用户可见的简短结果说明。 */
  message: string;
}

/**
 * 需要凭据的配置项。
 *
 * 用枚举而不是直接传 URL：控制台地址属于 Power 的领域知识，集中定义在一处；
 * 渲染层只说「要开哪一项的控制台」，不能借这个动作打开任意地址。
 */
export type WebCredentialTarget =
  | "tavily_api_key"
  | "exa_api_key"
  | "firecrawl_api_key"
  | "cdp_url";
