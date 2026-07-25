/**
 * Session runtime 端口类型。
 *
 * 职责说明（中文）
 * - 定义 Plugin、transport 与 Agent 内部运行时访问单个 Session 的稳定协议。
 * - 不暴露具体 Session class，也不包含 Session 集合管理能力。
 */

import type { LanguageModel } from "ai";
import type {
  SessionMetadataV1,
  SessionRecordV1,
} from "@/executor/types/SessionRecords.js";
import type {
  SessionRunInput,
  SessionRunResult,
} from "@/executor/types/SessionRun.js";
import type { AgentSessionPromptInput } from "@/types/sdk/AgentSessionPrompt.js";
import type { AgentSessionStopResult } from "@/types/sdk/AgentSessionStop.js";
import type { AgentSessionTurnHandle } from "@/types/sdk/AgentSessionTurn.js";
import type {
  SessionMutationSubscriber,
  SessionMutationUnsubscribe,
} from "@/types/session/SessionMutation.js";
import type { SessionContextSnapshot } from "@/types/session/SessionSegment.js";

/**
 * 单个 Session 执行端口。
 */
export interface SessionExecutorPort {
  /** 执行一次 Session run。 */
  run(params: SessionRunInput): Promise<SessionRunResult>;

  /**
   * 请求取消当前正在执行的 turn。
   *
   * @returns `true` 表示已发出取消请求；`false` 表示当前没有可取消的执行。
   */
  stop(): boolean;
}

/**
 * 单个 Session 实例端口。
 */
export interface SessionPort {
  /** 当前 Session 稳定标识。 */
  readonly session_id: string;

  /** 获取当前 Session 优先解析后的运行时模型实例。 */
  get_model(): LanguageModel | undefined;

  /** 获取当前 Session 的执行端口。 */
  get_executor(): SessionExecutorPort;

  /** 读取当前 Session 的累计 Summary 与 Active Message 快照。 */
  context(): Promise<SessionContextSnapshot>;

  /** 向当前 Session actor 追加一条新的 prompt。 */
  prompt(input: AgentSessionPromptInput): Promise<AgentSessionTurnHandle>;

  /** 停止当前 turn，并取消尚未被吸收的排队 prompt。 */
  stop(): Promise<AgentSessionStopResult>;

  /** 订阅当前 Session 后续产生的 future 事件。 */
  subscribe(subscriber: SessionMutationSubscriber): SessionMutationUnsubscribe;

  /**
   * 追加一条 user 消息。
   */
  append_user_message(params: {
    /** 已构造好的完整消息。 */
    message?: SessionRecordV1 | null;

    /** 未传入完整消息时使用的兜底文本。 */
    text?: string;

    /** 当前消息附加元数据。 */
    extra?: SessionMetadataV1["extra"];
  }): Promise<void>;

  /**
   * 追加一条 assistant 消息。
   */
  append_assistant_message(params: {
    /** 已构造好的完整消息。 */
    message?: SessionRecordV1 | null;

    /** 未传入完整消息时使用的兜底文本。 */
    fallback_text?: string;

    /** 当前消息附加元数据。 */
    extra?: SessionMetadataV1["extra"];
  }): Promise<void>;

  /** 返回当前 Session 是否正在执行。 */
  is_executing(): boolean;
}
