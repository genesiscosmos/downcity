/**
 * Session Interaction 通用协议。
 *
 * Interaction 只定义可持久化的生命周期与通用信封；业务类型和 payload
 * 由 Tool、Plugin、Shell 或宿主应用动态定义，前端可以自由选择渲染方式。
 */

import type { JsonValue } from "@/types/common/Json.js";

/** Interaction 当前生命周期状态。 */
export type SessionInteractionStatus =
  | "pending"
  | "resolved"
  | "denied"
  | "expired"
  | "cancelled"
  | "failed";

/** 高风险操作审批请求是否需要用户逐次确认。 */
export type SessionApprovalMode = "ask" | "always-allow";

/** Interaction 的执行来源。 */
export type SessionInteractionSource =
  | {
      /** 来源为 Tool Call。 */
      type: "tool";
      /** 发起 Interaction 的稳定 Tool Call 标识。 */
      tool_call_id?: string;
      /** 发起 Interaction 的工具注册名称。 */
      tool_name?: string;
    }
  | {
      /** 来源为 Plugin。 */
      type: "plugin";
      /** 发起 Interaction 的 Plugin 名称。 */
      plugin_name: string;
      /** Plugin 关联的 Tool Call 标识。 */
      tool_call_id?: string;
      /** Plugin 关联的 Tool 名称。 */
      tool_name?: string;
    }
  | {
      /** 来源为 Shell。 */
      type: "shell";
      /** 发起 Interaction 的 Shell Tool Call 标识。 */
      tool_call_id?: string;
      /** 发起 Interaction 的 Shell 工具名称。 */
      tool_name?: string;
    }
  | {
      /** 来源为不绑定具体 Tool 的 Session 执行过程。 */
      type: "execution";
      /** 可选关联的 Tool Call 标识。 */
      tool_call_id?: string;
      /** 可选关联的 Tool 名称。 */
      tool_name?: string;
    };

/** Interaction 请求公共字段。 */
export interface SessionInteractionRequest {
  /** 当前 Interaction 的稳定唯一标识。 */
  interaction_id: string;
  /** 当前 Interaction 所属 Turn 标识。 */
  turn_id: string;
  /** 动态业务类型；核心类型使用 question、approval 等，Plugin 使用命名空间。 */
  type: string;
  /** 当前 Interaction 的执行来源。 */
  source: SessionInteractionSource;
  /** 前端可选展示标题。 */
  title?: string;
  /** 前端可选展示描述。 */
  description?: string;
  /** 业务请求数据，由 type 对应的生产者解释。 */
  payload: JsonValue;
  /** 响应数据的声明式校验结构；不包含可执行 UI 代码。 */
  response_schema?: JsonValue;
  /** 当前 Interaction 创建时间戳，单位为毫秒。 */
  created_at: number;
  /** 当前 Interaction 自动过期时间戳，省略表示不自动过期。 */
  expires_at?: number;
}

/** Approval Interaction 的默认 payload 结构。 */
export interface SessionApprovalPayload {
  /** 当前审批决定对应的操作。 */
  operation: "exec" | "start" | "write" | "tool";
  /** 请求执行的命令或输入文本。 */
  command?: string;
  /** 请求执行时使用的工作目录。 */
  cwd?: string;
  /** 请求高风险操作的明确原因。 */
  reason?: string;
  /** Tool schema 校验通过后的真实调用输入。 */
  validated_input?: JsonValue;
  /** Tool 定义提供的稳定能力说明。 */
  tool_description?: string;
  /** 模型为当前调用给出的可选解释。 */
  model_explanation?: string;
}

/** Question 支持的回答形式。 */
export type SessionInteractionQuestionResponseType =
  | "text"
  | "single_select"
  | "multi_select";

/** Question 选择项。 */
export interface SessionInteractionOption {
  /** 当前选项在问题内的稳定值。 */
  value: string;
  /** 当前选项向用户展示的标签。 */
  label: string;
  /** 当前选项的可选解释。 */
  description?: string;
}

/** 一条等待用户回答的问题。 */
export interface SessionInteractionQuestion {
  /** 当前问题在 Interaction 内的稳定标识。 */
  question_id: string;
  /** 向用户展示的完整问题文本。 */
  prompt: string;
  /** 当前问题要求的回答形式。 */
  response_type: SessionInteractionQuestionResponseType;
  /** 单选或多选问题允许选择的候选项。 */
  options?: SessionInteractionOption[];
}

/** Question Interaction 的默认 payload 结构。 */
export interface SessionQuestionPayload {
  /** Interaction 包含的一到多条问题。 */
  questions: SessionInteractionQuestion[];
}

/** Approval Interaction 的用户响应 payload。 */
export interface SessionApprovalResponsePayload {
  /** 用户对审批作出的最终决定。 */
  decision: "approved" | "denied";
  /** 拒绝时的可选原因。 */
  reason?: string;
}

/** 单条 Question 回答。 */
export interface SessionInteractionAnswer {
  /** 当前回答对应的问题标识。 */
  question_id: string;
  /** 文本或选择回答值；多选回答使用字符串数组。 */
  value: string | string[];
}

/** Question Interaction 的用户响应 payload。 */
export interface SessionQuestionResponsePayload {
  /** 按 question_id 关联的完整回答集合。 */
  answers: SessionInteractionAnswer[];
}

/** 用户提交一次 Interaction 响应的通用结构。 */
export interface SessionInteractionResponse {
  /** 必须与原请求 type 一致。 */
  type: string;
  /** 用户是否允许当前 Interaction 继续。 */
  outcome: "resolved" | "denied";
  /** 业务响应数据，由 type 对应的生产者解释。 */
  payload: JsonValue;
}

/** 用户提交一次 Interaction 响应的公开输入。 */
export interface RespondSessionInteractionInput {
  /** 需要响应的 pending Interaction 标识。 */
  interaction_id: string;
  /** 与原请求 type 一致的结构化响应。 */
  response: SessionInteractionResponse;
}

/** Interaction 已成功收到用户响应。 */
export interface SessionResolvedInteractionResult {
  /** 终态固定为 resolved。 */
  status: "resolved";
  /** 已完成的 Interaction 标识。 */
  interaction_id: string;
  /** 已持久化的结构化用户响应。 */
  response: SessionInteractionResponse;
}

/** Interaction 被拒绝。 */
export interface SessionDeniedInteractionResult {
  /** 终态固定为 denied。 */
  status: "denied";
  /** 被拒绝的 Interaction 标识。 */
  interaction_id: string;
  /** 可选拒绝原因。 */
  reason?: string;
}

/** Interaction 因等待超时结束。 */
export interface SessionExpiredInteractionResult {
  /** 终态固定为 expired。 */
  status: "expired";
  /** 已过期的 Interaction 标识。 */
  interaction_id: string;
}

/** Interaction 因 Session 生命周期变化被取消。 */
export interface SessionCancelledInteractionResult {
  /** 终态固定为 cancelled。 */
  status: "cancelled";
  /** 已取消的 Interaction 标识。 */
  interaction_id: string;
  /** Interaction 被取消的稳定原因。 */
  reason: "turn_stopped" | "session_disposed" | "runtime_interrupted";
}

/** Interaction 执行失败。 */
export interface SessionFailedInteractionResult {
  /** 终态固定为 failed。 */
  status: "failed";
  /** 执行失败的 Interaction 标识。 */
  interaction_id: string;
  /** 稳定失败说明。 */
  error: string;
}

/** Interaction 等待方最终收到的领域结果。 */
export type SessionInteractionResult =
  | SessionResolvedInteractionResult
  | SessionDeniedInteractionResult
  | SessionExpiredInteractionResult
  | SessionCancelledInteractionResult
  | SessionFailedInteractionResult;

/** 当前 Session 中一条 pending Interaction 的公开快照。 */
export interface SessionPendingInteraction {
  /** 已持久化的完整 Interaction 请求。 */
  request: SessionInteractionRequest;
}

/** 执行方等待一次 Interaction 的运行时句柄。 */
export interface SessionInteractionHandle {
  /** 已成功持久化并等待响应的 Interaction 标识。 */
  interaction_id: string;
  /** Interaction 进入终态后兑现的领域结果。 */
  result: Promise<SessionInteractionResult>;
}

/** 执行面请求用户异步参与的最小端口。 */
export interface SessionInteractionPort {
  /** 创建并持久化一次 Interaction，返回等待终态结果的句柄。 */
  request(
    request: SessionInteractionRequest,
  ): Promise<SessionInteractionHandle>;
}

/** 控制面结束 Turn 时使用的 Interaction 生命周期端口。 */
export interface SessionInteractionLifecycle {
  /** 取消当前 Session 中全部 pending Interaction。 */
  cancel_all(
    reason: "turn_stopped" | "session_disposed" | "runtime_interrupted",
  ): Promise<void>;
}

/** 默认审批响应 schema，供前端生成自由实现的控件。 */
export const SESSION_APPROVAL_RESPONSE_SCHEMA: JsonValue = {
  type: "object",
  required: ["decision"],
  properties: {
    decision: { type: "string", enum: ["approved", "denied"] },
  },
};
