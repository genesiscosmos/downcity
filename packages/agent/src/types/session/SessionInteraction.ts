/**
 * Session 用户异步交互协议。
 *
 * Interaction 表示当前 Turn 在执行过程中需要用户参与。执行方发起请求后等待，
 * Session 先持久化请求并通知客户端；客户端响应完成持久化后，原执行才会恢复。
 */

/** Interaction 当前生命周期状态。 */
export type SessionInteractionStatus =
  | "pending"
  | "resolved"
  | "expired"
  | "cancelled";

/** 高风险操作请求是否需要用户逐次确认。 */
export type SessionApprovalMode = "ask" | "always-allow";

/** 当前 Session 的高风险操作审批模式快照。 */
export interface SessionApprovalModeSnapshot {
  /** 当前审批模式所属 Session 标识。 */
  session_id: string;
  /** 当前 Session 生效的审批模式。 */
  mode: SessionApprovalMode;
}

/** 更新当前 Session 高风险操作审批模式的输入。 */
export interface SetSessionApprovalModeInput {
  /** 需要设置的新审批模式。 */
  mode: SessionApprovalMode;
}

/** Interaction 的执行来源。 */
export type SessionInteractionSource =
  | {
      /** 来源固定为 Tool Call。 */
      type: "tool";
      /** 发起 Interaction 的稳定 Tool Call 标识。 */
      tool_call_id: string;
      /** 发起 Interaction 的工具注册名称。 */
      tool_name: string;
    }
  | {
      /** 来源为不绑定具体 Tool 的 Session 执行过程。 */
      type: "execution";
    };

/** Interaction 请求公共字段。 */
export interface SessionInteractionRequestBase {
  /** 当前 Interaction 的稳定唯一标识。 */
  interaction_id: string;
  /** 当前 Interaction 所属 Turn 标识。 */
  turn_id: string;
  /** 当前 Interaction 的执行来源。 */
  source: SessionInteractionSource;
  /** 当前 Interaction 创建时间戳，单位为毫秒。 */
  created_at: number;
  /** 当前 Interaction 自动过期时间戳，省略表示不自动过期。 */
  expires_at?: number;
}

/** 高风险操作审批请求。 */
export interface SessionApprovalInteractionRequest
  extends SessionInteractionRequestBase {
  /** Interaction 类型固定为 approval。 */
  kind: "approval";
  /** 审批界面展示标题。 */
  title: string;
  /** 审批界面展示的可选补充说明。 */
  description?: string;
  /** 请求执行的命令或输入文本。 */
  command: string;
  /** 请求执行时使用的工作目录。 */
  cwd: string;
  /** 请求高权限操作的明确原因。 */
  reason: string;
  /** 当前审批对应的操作类别。 */
  operation: "exec" | "start" | "write";
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

/** 向用户提问的 Interaction 请求。 */
export interface SessionQuestionInteractionRequest
  extends SessionInteractionRequestBase {
  /** Interaction 类型固定为 question。 */
  kind: "question";
  /** 问题界面展示标题。 */
  title: string;
  /** 当前 Interaction 包含的一到多条问题。 */
  questions: SessionInteractionQuestion[];
}

/** Session 支持的全部 Interaction 请求。 */
export type SessionInteractionRequest =
  | SessionApprovalInteractionRequest
  | SessionQuestionInteractionRequest;

/** Approval Interaction 的用户响应。 */
export interface SessionApprovalInteractionResponse {
  /** 响应类型固定为 approval。 */
  kind: "approval";
  /** 用户对高风险操作作出的最终决定。 */
  decision: "approved" | "denied";
}

/** 单条 Question 回答。 */
export interface SessionInteractionAnswer {
  /** 当前回答对应的问题标识。 */
  question_id: string;
  /** 文本或单选回答值；多选回答使用字符串数组。 */
  value: string | string[];
}

/** Question Interaction 的用户响应。 */
export interface SessionQuestionInteractionResponse {
  /** 响应类型固定为 question。 */
  kind: "question";
  /** 按 question_id 关联的完整回答集合。 */
  answers: SessionInteractionAnswer[];
}

/** Session 支持的全部 Interaction 用户响应。 */
export type SessionInteractionResponse =
  | SessionApprovalInteractionResponse
  | SessionQuestionInteractionResponse;

/** 用户提交一次 Interaction 响应的公开输入。 */
export interface RespondSessionInteractionInput {
  /** 需要响应的 pending Interaction 标识。 */
  interaction_id: string;
  /** 与原请求 kind 一致的结构化响应。 */
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

/** Interaction 等待方最终收到的领域结果。 */
export type SessionInteractionResult =
  | SessionResolvedInteractionResult
  | SessionExpiredInteractionResult
  | SessionCancelledInteractionResult;

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
