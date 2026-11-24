/** 可编程执行的受限消息与结果协议；消息中不携带宿主对象。 */
import type { ApplicationDescriptor } from "../../../../../application/types/Application.js";

/** 一次独立代码单元。 */
export interface ExecuteInput {
  /** UTF-8 源码，上限 128 KiB。 */
  readonly code: string;
  /** 是否启用 TypeScript 类型诊断。 */
  readonly language: "javascript" | "typescript";
  /** 不计审批的活动墙钟预算。 */
  readonly timeout_ms: number;
  /** 返回给模型的近似 token 预算。 */
  readonly max_output_tokens: number;
}

/** Worker 收到的可信执行消息。 */
export interface EngineInput extends ExecuteInput {
  /** 宿主生成的执行代次标识。 */
  readonly execution_id: string;
  /** 当前 SDK 的完整公开声明。 */
  readonly declarations: string;
  /** 由公开契约生成的 client 导出清单。 */
  readonly descriptors: readonly ApplicationDescriptor[];
}

/** Worker 返回的代码单元结果。 */
export interface EngineResult {
  /** 通过严格 JSON 检查的返回值。 */
  readonly value: unknown;
  /** 合并预算后的控制台输出。 */
  readonly logs: readonly string[];
  /** 编译、脚本或序列化错误文本。 */
  readonly error?: string;
}

/** 每次 SDK 调用的可查询完成事实。 */
export interface CallReceipt {
  /** 宿主生成的稳定回执标识。 */
  readonly receipt_id: string;
  /** 本次执行标识。 */
  readonly execution_id: string;
  /** 显式公开 SDK 方法。 */
  readonly symbol: string;
  /** 未决不表示回滚；超时可产生 outcome_unknown。 */
  status: "pending" | "completed" | "denied" | "failed" | "outcome_unknown";
  /** 可公开的错误文本，不包含内部对象或秘密。 */
  error?: string;
}

/** 公开机器错误；不把宿主 Error 实例或内部堆栈传给脚本。 */
export interface RuntimeError {
  /** 稳定错误类别，供调用方选择恢复步骤。 */
  readonly code: string;
  /** 非秘密错误说明。 */
  readonly message: string;
  /** 可用时定位本次用户源码，行列从 1 开始。 */
  readonly location?: {
    /** 用户源码行号。 */
    readonly line: number;
    /** 用户源码列号。 */
    readonly column: number;
  };
}

/** 单次执行的有界模型结果。 */
export interface ExecuteResult {
  /** 宿主生成的本次执行 ID。 */
  readonly execution_id: string;
  /** 当前 Session 引擎代次。 */
  readonly runtime_generation: number;
  /** 本次终态。 */
  readonly status: "completed" | "failed" | "cancelled" | "timed_out";
  /** JSON 返回值；截断时为空并提供结果引用。 */
  readonly value: unknown;
  /** 有界日志。 */
  readonly logs: readonly string[];
  /** 有界调用摘要；完整记录可通过 runtime.receipts 查询。 */
  readonly calls: readonly CallReceipt[];
  /** 错误文本，成功时为空。 */
  readonly error: RuntimeError | null;
  /** 状态回收或强制取消后提示调用者。 */
  readonly state_reset: boolean;
  /** 非秘密完整结果的短期存储引用。 */
  readonly result_ref?: string;
}
