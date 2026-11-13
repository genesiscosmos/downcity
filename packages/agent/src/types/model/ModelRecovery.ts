/**
 * 模型请求恢复的内部执行契约。
 * 恢复器拥有 step 预算与退避，调用方把信号仅传给模型消费阶段，工具执行仍使用原始 turn 信号。
 */
import type { ModelRequestKind } from "@downcity/type";
import type { ModelStreamFailure } from "@/model/ModelStreamFailure.js";
import type { ModelRequestFailureReporter } from "./ModelRequest.js";

/** 一次 step 的模型调用及其有限恢复配置。 */
export interface ExecuteModelRequestInput<TResult> {
  /** 模型请求用途，用于失败通知和诊断。 */
  request_kind: ModelRequestKind;
  /** 执行一次调用；接收模型专用的取消/恢复期限信号，不能替代工具执行信号。 */
  execute_attempt: (signal: AbortSignal) => Promise<TResult>;
  /** 用户或 turn 的取消信号。 */
  abort_signal?: AbortSignal;
  /** 本 step 所有模型尝试及等待的总墙钟预算，默认 900000 毫秒。 */
  recovery_timeout_ms?: number;
  /** 逐次失败通知；失败不得改变恢复结果。 */
  on_failure?: ModelRequestFailureReporter;
  /** 调用方额外恢复条件，例如把上下文超限交给摘要逻辑。 */
  should_retry?: (error: ModelStreamFailure) => boolean;
}
