/** 请求级完成回调：函数由应用注册，prompt 只保存可序列化名称和业务参数。 */
import type { JsonValue, ToolCallContext } from "@downcity/type";
import type { AgentSessionTurnResult } from "@/types/sdk/AgentSessionTurn.js";

/** 本次 prompt 的持久化回调配置。 */
export interface SessionCallback {
  /** 应用注册的稳定名称；重启后使用相同名称重新注册函数。 */
  name: string;
  /** 本次工作的 JSON 业务参数，不得包含函数或运行时对象。 */
  data?: JsonValue;
}

/** 运行时传给回调的单次请求结果。 */
export interface SessionCallbackInput {
  /** 本次请求对该回调的稳定投递标识，用于外部副作用幂等。 */
  delivery_id: string;
  /** 发起 prompt 时提供的稳定业务请求标识。 */
  request_id: string;
  /** 实际执行结果，失败重试 callback 不会改变它。 */
  result: AgentSessionTurnResult;
  /** prompt 保存的业务参数；未提供时为 null。 */
  data: JsonValue;
}

/** 回调只负责接受结果；外部 I/O 应使用 context.abort_signal 支持取消。 */
export type SessionCallbackHandler = (input: SessionCallbackInput, context: ToolCallContext) => Promise<void>;

/** 应用注册表，键是稳定 callback 名称。 */
export type SessionCallbacks = Readonly<Record<string, SessionCallbackHandler>>;
