/** Web Plugin 配置界面与宿主动作之间的可序列化协议。 */

import type { PluginJsonObject } from "@downcity/city/plugin";
import type { WebPluginConfig } from "@/web/types/WebPlugin.js";

/** Config Renderer 可读取的脱敏配置。 */
export interface WebPluginConfigView extends PluginJsonObject {
  /** 搜索 Provider。 */
  search_provider: NonNullable<WebPluginConfig["search_provider"]>;
  /** 文档 Provider。 */
  document_provider: NonNullable<WebPluginConfig["document_provider"]>;
  /** 浏览器 Provider。 */
  browser_provider: NonNullable<WebPluginConfig["browser_provider"]>;
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

/** Config Renderer 保存的配置输入。 */
export interface WebPluginConfigSaveInput {
  /** 搜索 Provider。 */
  search_provider: NonNullable<WebPluginConfig["search_provider"]>;
  /** 文档 Provider。 */
  document_provider: NonNullable<WebPluginConfig["document_provider"]>;
  /** 浏览器 Provider。 */
  browser_provider: NonNullable<WebPluginConfig["browser_provider"]>;
  /** 新 Tavily Key；空值表示保留已有 Key。 */
  tavily_api_key?: string;
  /** 是否显式删除 Tavily Key。 */
  clear_tavily_api_key?: boolean;
  /** 新 Exa Key；空值表示保留已有 Key。 */
  exa_api_key?: string;
  /** 是否显式删除 Exa Key。 */
  clear_exa_api_key?: boolean;
  /** 新 Firecrawl Key；空值表示保留已有 Key。 */
  firecrawl_api_key?: string;
  /** 是否显式删除 Firecrawl Key。 */
  clear_firecrawl_api_key?: boolean;
  /** 外部 CDP 地址。 */
  cdp_url?: string;
  /** 可选本地浏览器路径。 */
  browser_executable_path?: string;
  /** 新 Session 默认 URL。 */
  default_url?: string;
  /** 网络与浏览器操作超时。 */
  timeout_ms?: number;
  /** 页面观察字符上限。 */
  max_observation_chars?: number;
}

/** 配置页能力测试输入。 */
export interface WebPluginConfigTestInput extends PluginJsonObject {
  /** 要测试的能力类别。 */
  capability: "search" | "document" | "browser";
}

/** 配置页能力测试结果。 */
export interface WebPluginConfigTestResult extends PluginJsonObject {
  /** 测试是否成功。 */
  success: boolean;
  /** 用户可见的简短结果说明。 */
  message: string;
}

/** Web 配置 Renderer 的本地编辑状态。 */
export interface WebPluginConfigDraft extends WebPluginConfigView {
  /** 本次准备写入的新 Tavily Key。 */
  tavily_api_key: string;
  /** 本次准备写入的新 Exa Key。 */
  exa_api_key: string;
  /** 本次准备写入的新 Firecrawl Key。 */
  firecrawl_api_key: string;
  /** 用户是否要求清除 Tavily Key。 */
  clear_tavily_api_key: boolean;
  /** 用户是否要求清除 Exa Key。 */
  clear_exa_api_key: boolean;
  /** 用户是否要求清除 Firecrawl Key。 */
  clear_firecrawl_api_key: boolean;
}
