/**
 * Downcity 可执行模型客户端协议模块。
 *
 * 客户端只暴露标准流调用，不继承任何 Provider 的模型接口。
 */

import type { ModelCall } from "./ModelCall.js";
import type { ModelStreamEvent } from "./ModelStreamEvent.js";

/** 可执行 Downcity 模型客户端。 */
export interface ModelClient {
  /** Federation 模型目录中的模型 ID。 */
  readonly id: string;
  /** 模型的可读名称；未提供时展示稳定 ID。 */
  readonly name?: string;
  /** 模型支持的总上下文窗口，单位为 token。 */
  readonly context_window?: number;
  /** 使用标准 Downcity 协议执行一个模型 step。 */
  stream(call: ModelCall, signal?: AbortSignal): Promise<ReadableStream<ModelStreamEvent>>;
}
