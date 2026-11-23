/**
 * Downcity 可执行模型客户端协议模块。
 *
 * 客户端只暴露标准流调用，不继承任何 Provider 的模型接口。
 */

import type { ModelStreamPolicy } from "./ModelStreamPolicy.js";
import type { ModelCall } from "./ModelCall.js";
import type { ModelStreamEvent } from "./ModelStreamEvent.js";
import type { ModelReference } from "../CityModel.js";

/** 可执行 Downcity 模型客户端。 */
export interface ModelClient {
  /** 可执行模型的稳定 ID；由提供客户端的宿主定义。 */
  readonly id: string;
  /** 由 Town 提供的结构化来源引用；独立扩展模型可以省略。 */
  readonly model_reference?: ModelReference;
  /** 宿主捕获的不透明、非秘密授权来源标识；用于恢复身份核对，不是凭据。直接客户端可省略。 */
  readonly binding_id?: string;
  /** 模型的可读名称；未提供时展示稳定 ID。 */
  readonly name?: string;
  /** 模型支持的总上下文窗口，单位为 token。 */
  readonly context_window?: number;
  /** 宿主设置的模型流期限；Agent 使用相同策略守护自定义客户端，未提供时使用默认值。 */
  readonly model_stream_policy?: Partial<ModelStreamPolicy>;
  /** 使用标准 Downcity 协议执行一个模型 step。 */
  stream(call: ModelCall, signal?: AbortSignal): Promise<ReadableStream<ModelStreamEvent>>;
}
