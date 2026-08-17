/**
 * WebPlugin 的公开协议类型。
 *
 * 关键点（中文）
 * - WebPlugin 只定义联网能力的稳定边界，不绑定搜索服务、浏览器云厂商或模型。
 * - 浏览器 provider 负责 session 的创建、观察、动作执行和关闭。
 * - 所有 action 返回值都保持 JSON 可序列化，避免把 Playwright 对象泄漏到 Agent 内核。
 */

import type { JsonObject } from "@downcity/agent";

/** WebPlugin 对外 action 名称。 */
export const WEB_PLUGIN_ACTIONS = {
  /** 搜索公开网页或索引。 */
  search: "search",
  /** 打开已知 URL 并读取文档。 */
  open: "open",
  /** 创建浏览器 session。 */
  browser_create_session: "browser_create_session",
  /** 读取浏览器当前状态。 */
  browser_observe: "browser_observe",
  /** 执行一个确定性的浏览器动作。 */
  browser_act: "browser_act",
  /** 执行一个由语义 provider 解释的自然语言动作。 */
  browser_semantic_act: "browser_semantic_act",
  /** 从当前浏览器页面抽取文本。 */
  browser_extract: "browser_extract",
  /** 使用语义 provider 抽取页面内容。 */
  browser_semantic_extract: "browser_semantic_extract",
  /** 关闭浏览器 session。 */
  browser_close_session: "browser_close_session",
} as const;

/** WebPlugin action 名称联合类型。 */
export type WebPluginActionName =
  (typeof WEB_PLUGIN_ACTIONS)[keyof typeof WEB_PLUGIN_ACTIONS];

/** 搜索 action 输入。 */
export interface WebSearchInput {
  /** 用户要检索的自然语言查询。 */
  query: string;
  /** 最多返回的结果数量，provider 可自行设置上限。 */
  limit?: number;
  /** 只搜索这些域名；不传时由 provider 决定搜索范围。 */
  domains?: string[];
}

/** 单条搜索结果。 */
export interface WebSearchItem extends JsonObject {
  /** 结果页面的规范 URL。 */
  url: string;
  /** 页面标题。 */
  title: string | null;
  /** 搜索 provider 返回的摘要。 */
  snippet: string | null;
  /** provider 给出的相关性分数。 */
  score: number | null;
}

/** 搜索 action 返回值。 */
export interface WebSearchResult extends JsonObject {
  /** 实际使用的 provider 名称。 */
  provider: string;
  /** 搜索结果列表。 */
  items: WebSearchItem[];
}

/** 已知 URL 打开输入。 */
export interface WebOpenInput {
  /** 要读取的 HTTP(S) URL。 */
  url: string;
  /** 返回正文的最大字符数。 */
  max_chars?: number;
}

/** 已知 URL 打开返回值。 */
export interface WebOpenResult extends JsonObject {
  /** 实际使用的 provider 名称。 */
  provider: string;
  /** 最终读取到的 URL。 */
  url: string;
  /** 页面标题。 */
  title: string | null;
  /** 页面正文或 provider 生成的 Markdown。 */
  content: string;
}

/** 浏览器 session 创建输入。 */
export interface BrowserCreateSessionInput {
  /** 创建后立即打开的 URL。 */
  url?: string;
  /** 是否在首次观察时返回 PNG data URL。 */
  include_screenshot?: boolean;
}

/** 浏览器页面的可序列化观察结果。 */
export interface BrowserObservation extends JsonObject {
  /** 实际使用的 provider 名称。 */
  provider: string;
  /** 浏览器 session 标识。 */
  session_id: string;
  /** 当前页面 URL。 */
  url: string;
  /** 当前页面标题。 */
  title: string;
  /** 当前页面的可见文本快照。 */
  text: string;
  /** 可选的 PNG data URL，供视觉模型使用。 */
  screenshot_data_url: string | null;
}

/** 浏览器动作输入。 */
export type BrowserAction =
  | { /** 导航到目标地址。 */ type: "goto"; /** 目标 URL。 */ url: string }
  | { /** 点击元素。 */ type: "click"; /** CSS selector。 */ selector: string }
  | {
      /** 填充表单元素。 */
      type: "fill";
      /** CSS selector。 */
      selector: string;
      /** 要填充的文本。 */
      value: string;
    }
  | {
      /** 在元素上按键。 */
      type: "press";
      /** CSS selector。 */
      selector: string;
      /** Playwright 支持的键名。 */
      key: string;
    }
  | {
      /** 滚动页面。 */
      type: "scroll";
      /** 垂直滚动像素，正数向下。 */
      y?: number;
      /** 水平滚动像素，正数向右。 */
      x?: number;
    }
  | {
      /** 等待页面稳定。 */
      type: "wait";
      /** 等待毫秒数，provider 可限制最大值。 */
      milliseconds?: number;
    };

/** 浏览器动作输入 payload。 */
export interface BrowserActInput {
  /** 目标浏览器 session 标识。 */
  session_id: string;
  /** 要执行的确定性动作。 */
  action: BrowserAction;
  /** 动作完成后是否附带截图。 */
  include_screenshot?: boolean;
}

/** 语义浏览器动作输入。 */
export interface BrowserSemanticActInput {
  /** 目标浏览器 session 标识。 */
  session_id: string;
  /** 给语义 provider 的自然语言动作，例如“点击登录按钮”。 */
  instruction: string;
  /** 动作完成后是否附带截图。 */
  include_screenshot?: boolean;
}

/** 浏览器观察输入 payload。 */
export interface BrowserObserveInput {
  /** 目标浏览器 session 标识。 */
  session_id: string;
  /** 是否返回 PNG data URL。 */
  include_screenshot?: boolean;
}

/** 浏览器抽取输入 payload。 */
export interface BrowserExtractInput {
  /** 目标浏览器 session 标识。 */
  session_id: string;
  /** 可选 CSS selector；不传时读取 body 文本。 */
  selector?: string;
  /** 返回的最大字符数。 */
  max_chars?: number;
}

/** 语义浏览器抽取输入。 */
export interface BrowserSemanticExtractInput {
  /** 目标浏览器 session 标识。 */
  session_id: string;
  /** 给语义 provider 的抽取要求。 */
  instruction: string;
  /** 返回内容的最大字符数。 */
  max_chars?: number;
}

/** 浏览器抽取返回值。 */
export interface BrowserExtractResult extends JsonObject {
  /** 实际使用的 provider 名称。 */
  provider: string;
  /** 浏览器 session 标识。 */
  session_id: string;
  /** 当前页面 URL。 */
  url: string;
  /** 抽取到的文本。 */
  content: string;
}

/** 浏览器 session 关闭输入。 */
export interface BrowserCloseSessionInput {
  /** 要关闭的浏览器 session 标识。 */
  session_id: string;
}

/** 浏览器 provider 的能力协议。 */
export interface BrowserProvider {
  /** provider 稳定名称，用于结果和诊断。 */
  readonly name: string;
  /** 创建浏览器 session 并返回初始观察结果。 */
  create_session(
    input: BrowserCreateSessionInput,
  ): Promise<BrowserObservation>;
  /** 读取指定 session 当前状态。 */
  observe(input: BrowserObserveInput): Promise<BrowserObservation>;
  /** 执行确定性动作并返回动作后的状态。 */
  act(input: BrowserActInput): Promise<BrowserObservation>;
  /** 可选的自然语言动作能力，由 Stagehand 或 Computer Use adapter 实现。 */
  semantic_act?(input: BrowserSemanticActInput): Promise<BrowserObservation>;
  /** 从指定 session 抽取文本。 */
  extract(input: BrowserExtractInput): Promise<BrowserExtractResult>;
  /** 可选的自然语言结构化抽取能力。 */
  semantic_extract?(
    input: BrowserSemanticExtractInput,
  ): Promise<BrowserExtractResult>;
  /** 关闭指定 session。 */
  close_session(input: BrowserCloseSessionInput): Promise<void>;
  /** 释放 provider 持有的浏览器连接和剩余 session。 */
  dispose(): Promise<void>;
}

/** WebPlugin profile。 */
export interface WebPluginProfile {
  /** 浏览器实现类型。 */
  browser?: "playwright";
  /** 浏览器 CDP 地址。 */
  cdp_url?: string;
  /** 新建 Session 时使用的默认地址。 */
  default_url?: string;
  /** 浏览器操作超时时间。 */
  timeout_ms?: number;
  /** 页面观察的最大字符数。 */
  max_observation_chars?: number;
}

/** WebPlugin profile 的兼容名称别名。 */
export type WebPluginOptions = WebPluginProfile;
