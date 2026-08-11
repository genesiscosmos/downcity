/**
 * Session 的统一实时 Mutation 协议。
 *
 * Mutation 描述订阅之后发生的状态变化，不等同于 Active/Segment 持久化格式。
 */

import type { SessionAssistantMessagePart, SessionMessage } from "@/types/session/SessionMessage.js";
import type { AgentSessionCompactReason } from "@/types/sdk/AgentSessionCompact.js";

/** 所有 Session Mutation 的公共字段。 */
export interface SessionMutationBase {
  /** 当前 Mutation 的稳定唯一标识。 */
  mutation_id: string;
  /** 当前 Mutation 所属 Session 标识。 */
  session_id: string;
  /** 当前 Mutation 创建时间戳（ms）。 */
  created_at: number;
}
/** Message 创建或完整快照更新 Mutation。 */
export type SessionMessageMutation = {
  [TType in SessionMessage["type"]]: SessionMutationBase & {
    /** Mutation 层级固定为 message。 */
    variant: "message";
    /** 当前完整 Message 类型。 */
    type: TType;
    /** 当前 Mutation 目标 Message 标识。 */
    message_id: string;
    /** 当前 Mutation 所属 Turn 标识。 */
    turn_id?: string;
    /** 当前 Message 在线性 Session 中的不可变顺序。 */
    sequence: number;
    /** 应用当前 Mutation 后的 Message revision。 */
    revision: number;
    /** 创建或更新后的完整 Message 快照。 */
    message: Extract<SessionMessage, { type: TType }>;
  };
}[SessionMessage["type"]];

/** Assistant Part 创建或完整快照更新 Mutation。 */
export type SessionPartMutation = {
  [TType in SessionAssistantMessagePart["type"]]: SessionMutationBase & {
    /** Mutation 层级固定为 part。 */
    variant: "part";
    /** 当前完整 Part 类型。 */
    type: TType;
    /** 当前 Part 所属 Message 标识。 */
    message_id: string;
    /** 当前 Mutation 所属 Turn 标识。 */
    turn_id?: string;
    /** 应用当前 Mutation 后的 Message revision。 */
    revision: number;
    /** 当前被创建或更新的 Part 标识。 */
    part_id: string;
    /** 创建或更新后的完整 Part 快照。 */
    part: SessionAssistantMessagePart & { type: TType };
  };
}[SessionAssistantMessagePart["type"]];

/** Assistant Part 原始增量 Mutation 的公共字段。 */
interface SessionDeltaMutationBase extends SessionMutationBase {
  /** Mutation 层级固定为 delta。 */
  variant: "delta";
  /** 当前 Delta 所属 Message 标识。 */
  message_id: string;
  /** 当前 Mutation 所属 Turn 标识。 */
  turn_id?: string;
  /** 应用当前 Mutation 后的 Message revision。 */
  revision: number;
  /** 当前 Delta 所属 Part 标识。 */
  part_id: string;
  /** 本次新增的原始文本，不是累计全文。 */
  delta: string;
}

/** Assistant 文本或推理的原始增量 Mutation。 */
interface SessionTextDeltaMutation extends SessionDeltaMutationBase {
  /** Delta 属于可见文本或推理文本。 */
  type: "text" | "reasoning";
}

/** Assistant Tool 输入的原始增量 Mutation。 */
interface SessionToolInputDeltaMutation extends SessionDeltaMutationBase {
  /** Delta 属于 Tool 输入参数原文。 */
  type: "tool_input";
  /** 当前 Delta 所属 Tool Call 标识。 */
  tool_call_id: string;
}

/** Assistant 文本、推理或 Tool 输入的原始增量 Mutation。 */
export type SessionDeltaMutation =
  | SessionTextDeltaMutation
  | SessionToolInputDeltaMutation;

/** Turn 生命周期 Mutation。 */
export type SessionTurnMutation = SessionMutationBase & {
  /** Mutation 层级固定为 turn。 */
  variant: "turn";
  /** 当前 Turn 是开始还是完成。 */
  type: "start" | "finish";
  /** 当前 Turn 的稳定唯一标识。 */
  turn_id: string;
  /** 当前 Turn 的执行状态。 */
  status: "running" | "completed" | "failed" | "stopped";
  /** Turn 完成时的最终可见文本。 */
  text?: string;
  /** Turn 失败或停止时的错误文本。 */
  error?: string;
};

/** 显式 Session 压缩请求的生命周期 Mutation。 */
export type SessionCompactMutation = SessionMutationBase & {
  /** Mutation 层级固定为 compact。 */
  variant: "compact";
  /** 当前压缩请求是进入队列还是已经结束。 */
  type: "start" | "finish";
  /** 当前显式压缩请求的稳定标识。 */
  compact_id: string;
  /** 当前压缩请求的生命周期状态。 */
  status: "queued" | "completed" | "failed";
  /** 完成时是否实际提交了压缩计划。 */
  compacted?: boolean;
  /** 完成时的稳定结束原因。 */
  reason?: AgentSessionCompactReason;
  /** 压缩失败时的错误文本。 */
  error?: string;
};

/** Session 标题变化 Mutation。 */
export type SessionTitleMutation = SessionMutationBase & {
  /** Mutation 层级固定为 session。 */
  variant: "session";
  /** 当前 Session 属性变化类型。 */
  type: "title";
  /** 当前 Session 最新标题。 */
  title: string;
};

/** Session 模型配置变化 Mutation。 */
export type SessionConfigMutation = SessionMutationBase & {
  /** Mutation 层级固定为 session。 */
  variant: "session";
  /** 当前 Session 属性变化类型。 */
  type: "config";
  /** 当前 Session 已接受的模型可读标签。 */
  model_label?: string;
  /** 当前模型支持的总上下文窗口长度，单位为 token。 */
  model_context_window?: number;
};

/** Session 自身属性变化 Mutation。 */
export type SessionStateMutation = SessionTitleMutation | SessionConfigMutation;

/** Session 对外唯一实时 Mutation 联合类型。 */
export type SessionMutation =
  | SessionMessageMutation
  | SessionPartMutation
  | SessionDeltaMutation
  | SessionTurnMutation
  | SessionCompactMutation
  | SessionStateMutation;

/** Session Mutation 订阅回调。 */
export type SessionMutationSubscriber = (
  mutation: SessionMutation,
) => void | Promise<void>;

/** 取消 Session Mutation 订阅的函数。 */
export type SessionMutationUnsubscribe = () => void;

/** 判断未知事件是否为 Session Mutation。 */
export function is_session_mutation(input: unknown): input is SessionMutation {
  if (!input || typeof input !== "object") return false;
  const candidate = input as { mutation_id?: unknown; variant?: unknown; type?: unknown };
  if (typeof candidate.mutation_id !== "string" || typeof candidate.type !== "string") return false;
  return (
    candidate.variant === "message" ||
    candidate.variant === "part" ||
    candidate.variant === "delta" ||
    candidate.variant === "turn" ||
    candidate.variant === "compact" ||
    candidate.variant === "session"
  );
}
