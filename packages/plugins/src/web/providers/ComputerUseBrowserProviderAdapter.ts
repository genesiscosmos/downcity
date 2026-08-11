/**
 * Provider-neutral Computer Use 浏览器 adapter。
 *
 * 关键点（中文）
 * - adapter 不依赖 OpenAI、Anthropic 或 Google SDK。
 * - 每次语义动作先获取带截图的当前状态，再交给宿主模型循环。
 * - 模型回调不能直接接触 Playwright 对象，只能返回 JSON observation。
 */

import type {
  BrowserActInput,
  BrowserCloseSessionInput,
  BrowserCreateSessionInput,
  BrowserExtractInput,
  BrowserExtractResult,
  BrowserObservation,
  BrowserObserveInput,
  BrowserProvider,
  BrowserSemanticActInput,
} from "@/web/types/WebPlugin.js";
import type {
  ComputerUseBrowserProviderAdapterOptions,
  ComputerUseBrowserProviderMethods,
} from "@/web/types/ComputerUseBrowserProviderAdapter.js";

/** 为基础浏览器组合 Computer Use 视觉回退。 */
export class ComputerUseBrowserProviderAdapter
  implements ComputerUseBrowserProviderMethods
{
  /** adapter 稳定名称。 */
  readonly name: string;

  /** 拥有 session 的基础浏览器 provider。 */
  private readonly browser: BrowserProvider;

  /** Computer Use 模型回调。 */
  private readonly run_callback: ComputerUseBrowserProviderAdapterOptions["run"];

  constructor(options: ComputerUseBrowserProviderAdapterOptions) {
    const name = String(options.name || "").trim();
    if (!name) throw new TypeError("ComputerUseBrowserProviderAdapter requires name");
    this.name = name;
    this.browser = options.browser;
    this.run_callback = options.run;
  }

  /** 委托创建浏览器 session。 */
  async create_session(
    input: BrowserCreateSessionInput,
  ): Promise<BrowserObservation> {
    return await this.browser.create_session(input);
  }

  /** 委托观察页面。 */
  async observe(input: BrowserObserveInput): Promise<BrowserObservation> {
    return await this.browser.observe(input);
  }

  /** 委托确定性动作。 */
  async act(input: BrowserActInput): Promise<BrowserObservation> {
    return await this.browser.act(input);
  }

  /** 获取截图并运行一次 Computer Use 模型循环。 */
  async semantic_act(
    input: BrowserSemanticActInput,
  ): Promise<BrowserObservation> {
    const observation = await this.browser.observe({
      session_id: input.session_id,
      include_screenshot: true,
    });
    return await this.run_callback({
      instruction: input.instruction,
      session_id: input.session_id,
      observation,
    });
  }

  /** 委托页面文本抽取。 */
  async extract(input: BrowserExtractInput): Promise<BrowserExtractResult> {
    return await this.browser.extract(input);
  }

  /** Computer Use adapter 不提供结构化语义抽取。 */
  async close_session(input: BrowserCloseSessionInput): Promise<void> {
    await this.browser.close_session(input);
  }

  /** 释放基础浏览器资源。 */
  async dispose(): Promise<void> {
    await this.browser.dispose();
  }
}
