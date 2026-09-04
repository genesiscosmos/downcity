/**
 * 语义浏览器 adapter 构造参数。
 *
 * 关键点（中文）：Stagehand、Computer Use 或其他模型只需要实现两个回调，
 * 浏览器 session 和确定性动作仍由基础 BrowserProvider 统一拥有。
 */

import type {
  BrowserObservation,
  BrowserProvider,
  BrowserSemanticActInput,
  BrowserSemanticExtractInput,
  BrowserExtractResult,
} from "@/web/types/WebPlugin.js";

/** 语义浏览器 adapter 构造参数。 */
export interface SemanticBrowserProviderAdapterOptions {
  /** adapter 稳定名称，例如 `stagehand` 或 `computer-use`。 */
  name: string;
  /** 拥有浏览器连接和 session 的基础 provider。 */
  browser: BrowserProvider;
  /** 执行自然语言浏览器动作的回调。 */
  semantic_act: (
    input: BrowserSemanticActInput,
  ) => Promise<BrowserObservation> | BrowserObservation;
  /** 执行自然语言页面抽取的回调。 */
  semantic_extract: (
    input: BrowserSemanticExtractInput,
  ) => Promise<BrowserExtractResult> | BrowserExtractResult;
}
