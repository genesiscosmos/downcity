/**
 * 在现有 BrowserProvider 上组合语义动作能力。
 *
 * 关键点（中文）
 * - 基础 provider 仍是 session 和浏览器资源的唯一拥有者。
 * - adapter 只解释自然语言动作和抽取，不复制 session 状态。
 * - Stagehand、Computer Use 与其他模型可以共享同一个公开协议。
 */

import type {
  BrowserActInput,
  BrowserCloseSessionInput,
  BrowserCreateSessionInput,
  BrowserExtractInput,
  BrowserObservation,
  BrowserObserveInput,
  BrowserProvider,
  BrowserSemanticActInput,
  BrowserSemanticExtractInput,
  BrowserExtractResult,
} from "@/web/types/WebPlugin.js";
import type { SemanticBrowserProviderAdapterOptions } from "@/web/types/SemanticBrowserProviderAdapter.js";

/** 为基础浏览器组合语义动作回调。 */
export class SemanticBrowserProviderAdapter implements BrowserProvider {
  /** adapter 稳定名称。 */
  readonly name: string;

  /** 拥有 session 的基础浏览器 provider。 */
  private readonly browser: BrowserProvider;

  /** 自然语言动作回调。 */
  private readonly semantic_act_callback: SemanticBrowserProviderAdapterOptions["semantic_act"];

  /** 自然语言抽取回调。 */
  private readonly semantic_extract_callback: SemanticBrowserProviderAdapterOptions["semantic_extract"];

  constructor(options: SemanticBrowserProviderAdapterOptions) {
    const name = String(options.name || "").trim();
    if (!name) throw new TypeError("SemanticBrowserProviderAdapter requires name");
    this.name = name;
    this.browser = options.browser;
    this.semantic_act_callback = options.semantic_act;
    this.semantic_extract_callback = options.semantic_extract;
  }

  /** 委托基础 provider 创建 session。 */
  async create_session(
    input: BrowserCreateSessionInput,
  ): Promise<BrowserObservation> {
    return await this.browser.create_session(input);
  }

  /** 委托基础 provider 观察页面。 */
  async observe(input: BrowserObserveInput): Promise<BrowserObservation> {
    return await this.browser.observe(input);
  }

  /** 委托基础 provider 执行确定性动作。 */
  async act(input: BrowserActInput): Promise<BrowserObservation> {
    return await this.browser.act(input);
  }

  /** 执行自然语言浏览器动作。 */
  async semantic_act(
    input: BrowserSemanticActInput,
  ): Promise<BrowserObservation> {
    return await this.semantic_act_callback(input);
  }

  /** 委托基础 provider 抽取确定性文本。 */
  async extract(input: BrowserExtractInput): Promise<BrowserExtractResult> {
    return await this.browser.extract(input);
  }

  /** 执行自然语言页面抽取。 */
  async semantic_extract(
    input: BrowserSemanticExtractInput,
  ): Promise<BrowserExtractResult> {
    return await this.semantic_extract_callback(input);
  }

  /** 委托基础 provider 关闭 session。 */
  async close_session(input: BrowserCloseSessionInput): Promise<void> {
    await this.browser.close_session(input);
  }

  /** 委托基础 provider 释放全部浏览器资源。 */
  async dispose(): Promise<void> {
    await this.browser.dispose();
  }
}
