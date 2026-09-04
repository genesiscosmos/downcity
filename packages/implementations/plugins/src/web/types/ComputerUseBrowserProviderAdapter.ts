/**
 * Computer Use 浏览器 adapter 类型。
 *
 * 关键点（中文）：模型只通过 run 回调决定下一步动作，浏览器 session 仍由基础
 * BrowserProvider 拥有；OpenAI、Anthropic、Gemini 或自建模型都可以实现该回调。
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

/** Computer Use 模型回调收到的输入。 */
export interface ComputerUseBrowserRunInput {
  /** 用户或 Agent 给出的高层目标。 */
  instruction: string;
  /** 当前浏览器 session 标识。 */
  session_id: string;
  /** 当前页面截图和文本观察结果。 */
  observation: BrowserObservation;
}

/** Computer Use adapter 构造参数。 */
export interface ComputerUseBrowserProviderAdapterOptions {
  /** adapter 稳定名称，例如 `openai-computer-use`。 */
  name: string;
  /** 拥有浏览器连接和 session 的基础 provider。 */
  browser: BrowserProvider;
  /** 执行一次 Computer Use 模型循环的回调。 */
  run: (
    input: ComputerUseBrowserRunInput,
  ) => Promise<BrowserObservation> | BrowserObservation;
}

/** Computer Use adapter 的内部委托接口。 */
export type ComputerUseBrowserProviderMethods = {
  /** 创建浏览器 session。 */
  create_session(input: BrowserCreateSessionInput): Promise<BrowserObservation>;
  /** 观察浏览器页面。 */
  observe(input: BrowserObserveInput): Promise<BrowserObservation>;
  /** 执行确定性浏览器动作。 */
  act(input: BrowserActInput): Promise<BrowserObservation>;
  /** 抽取页面文本。 */
  extract(input: BrowserExtractInput): Promise<BrowserExtractResult>;
  /** 关闭浏览器 session。 */
  close_session(input: BrowserCloseSessionInput): Promise<void>;
  /** 释放浏览器资源。 */
  dispose(): Promise<void>;
  /** 执行 Computer Use 语义动作。 */
  semantic_act(input: BrowserSemanticActInput): Promise<BrowserObservation>;
};
