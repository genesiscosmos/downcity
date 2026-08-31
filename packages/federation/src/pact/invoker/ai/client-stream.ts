/**
 * City 客户端 Downcity Model Protocol 流模块。
 *
 * 客户端直接发送 ModelCall 并返回 ModelStreamEvent，不承担 Session UI 或 Provider 转换。
 */

import type { ModelCall, ModelStreamEvent } from "@downcity/type";
import type { UserServiceInput } from "../../user/types.js";
import type { UserModelRef } from "./types.js";

/** 使用绑定当前鉴权上下文的 CityModel 执行一个标准模型 step。 */
export async function create_client_model_stream(
  input: UserServiceInput,
  model: UserModelRef,
): Promise<ReadableStream<ModelStreamEvent>> {
  const call = read_model_call(input.call);
  const signal = input.signal instanceof AbortSignal ? input.signal : undefined;
  return model.stream(call, signal);
}
/** 校验公开调用输入中的 ModelCall。 */
function read_model_call(value: unknown): ModelCall {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("city.ai.stream() requires call");
  }
  const call = value as Partial<ModelCall>;
  if (!Array.isArray(call.messages)) {
    throw new TypeError("city.ai.stream() requires call.messages");
  }
  return call as ModelCall;
}
