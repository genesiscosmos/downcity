/**
 * 单次模型流消费基础设施。
 *
 * 关键点（中文）
 * - 统一负责模型调用、协议校验、读取失败归一化与 reader 释放。
 * - 调用方通过事件回调维护自己的领域状态，本模块不理解 Session、Tool 或文本聚合。
 * - `has_partial_output` 由调用方基于已接收事实判断，保证失败恢复语义准确。
 */

import {
  ModelStreamValidator,
  type ModelCall,
  type ModelClient,
  type ModelStreamEvent,
} from "@downcity/type";
import {
  ModelStreamFailure,
  normalize_model_invocation_failure,
  normalize_model_protocol_failure,
} from "@executor/model/ModelStreamFailure.js";

/** 消费并校验一次完整模型事件流。 */
export async function consume_model_stream(
  model: ModelClient,
  call: ModelCall,
  abort_signal: AbortSignal | undefined,
  has_partial_output: () => boolean,
  accept_event: (event: ModelStreamEvent) => void | Promise<void>,
): Promise<void> {
  const validator = new ModelStreamValidator();
  let stream: ReadableStream<ModelStreamEvent>;
  try {
    stream = await model.stream(call, abort_signal);
  } catch (error) {
    throw normalize_model_invocation_failure(error, false, abort_signal);
  }

  const reader = stream.getReader();
  let stream_complete = false;
  try {
    while (true) {
      let result: Awaited<ReturnType<typeof reader.read>>;
      try {
        result = await reader.read();
      } catch (error) {
        throw normalize_model_invocation_failure(
          error,
          has_partial_output(),
          abort_signal,
        );
      }
      if (result.done) {
        stream_complete = true;
        break;
      }
      try {
        validator.accept(result.value);
      } catch (error) {
        throw normalize_model_protocol_failure(error, has_partial_output());
      }
      await accept_event(result.value);
      if (result.value.type === "model_error") {
        throw new ModelStreamFailure(result.value.error, has_partial_output());
      }
    }
  } finally {
    if (!stream_complete) await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }

  try {
    validator.finish();
  } catch (error) {
    throw normalize_model_protocol_failure(error, has_partial_output());
  }
}
