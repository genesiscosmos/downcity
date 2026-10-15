/**
 * 单次模型流消费基础设施。
 *
 * 统一负责模型调用、协议校验、读取失败归一化、reader 释放与阶段诊断。
 * 调用方通过事件回调维护领域状态；诊断只记录时序和事件类型，不记录请求正文。
 * `has_partial_output` 由调用方基于已接收事实判断，保证失败恢复语义准确。
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
} from "@/model/ModelStreamFailure.js";

/** 模型请求阶段快照；不包含消息或工具参数。 */
export interface ModelStreamDiagnostic {
  /** 触发快照的边界；waiting 为每 30 秒一次的进度记录。 */
  phase: "request_start" | "stream_open" | "first_event" | "stream_end" | "request_failed" | "waiting";
  /** 当前等待的操作，区分建立请求、读取流和处理输出回调。 */
  stage: "opening" | "reading" | "accepting" | "complete";
  /** 从开始调用模型到当前快照的毫秒数。 */
  elapsed_ms: number;
  /** 已从模型流读取到的事件数量。 */
  event_count: number;
  /** 最近一次读取到的事件类型；尚无事件时为 null。 */
  last_event_type: ModelStreamEvent["type"] | null;
  /** 最近一次读取到事件的 Unix 毫秒时间；尚无事件时为 null。 */
  last_event_at: number | null;
}

/** 消费并校验一次完整模型事件流，诊断失败不改变执行结果。 */
export async function consume_model_stream(
  model: ModelClient,
  call: ModelCall,
  abort_signal: AbortSignal | undefined,
  has_partial_output: () => boolean,
  accept_event: (event: ModelStreamEvent) => void | Promise<void>,
  on_diagnostic?: (diagnostic: ModelStreamDiagnostic) => void | Promise<void>,
): Promise<void> {
  const started_at = Date.now();
  let stage: ModelStreamDiagnostic["stage"] = "opening";
  let event_count = 0;
  let last_event_type: ModelStreamEvent["type"] | null = null;
  let last_event_at: number | null = null;
  const report = async (phase: ModelStreamDiagnostic["phase"]): Promise<void> => {
    try {
      await on_diagnostic?.({
        phase, stage, elapsed_ms: Date.now() - started_at,
        event_count, last_event_type, last_event_at,
      });
    } catch {
      // 诊断写入失败不能改变模型请求结果。
    }
  };
  const timer = on_diagnostic
    ? setInterval(() => { void report("waiting"); }, 30_000)
    : undefined;
  timer?.unref();
  try {
    await report("request_start");
    const validator = new ModelStreamValidator();
    let stream: ReadableStream<ModelStreamEvent>;
    try {
      stream = await model.stream(call, abort_signal);
    } catch (error) {
      throw normalize_model_invocation_failure(error, false, abort_signal);
    }
    stage = "reading";
    await report("stream_open");

    const reader = stream.getReader();
    let stream_complete = false;
    try {
      while (true) {
        let result: Awaited<ReturnType<typeof reader.read>>;
        try {
          stage = "reading";
          result = await reader.read();
        } catch (error) {
          throw normalize_model_invocation_failure(error, has_partial_output(), abort_signal);
        }
        if (result.done) {
          stream_complete = true;
          break;
        }
        event_count += 1;
        last_event_type = result.value.type;
        last_event_at = Date.now();
        stage = "accepting";
        if (event_count === 1) await report("first_event");
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
    stage = "complete";
    await report("stream_end");
  } catch (error) {
    await report("request_failed");
    throw error;
  } finally {
    if (timer) clearInterval(timer);
  }
}
