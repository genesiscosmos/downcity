/**
 * Agent 面向 SDK 用户的 Session 集合类型。
 *
 * Session 归 Agent 所有；Workspace 只在创建时声明本次执行使用的资源环境。
 */

import type { WorkspaceBase } from "@downcity/workspace";
import type { AgentSession } from "@/types/agent/SessionActor.js";
import type { AgentCreateSessionInput } from "@/types/agent/SessionTypes.js";
import type { SessionPort } from "@/types/session/SessionPort.js";
import type {
  AgentArchiveSessionInput,
  AgentArchiveSessionResult,
  AgentArchiveSessionsInput,
  AgentArchiveSessionsResult,
  AgentCleanArchiveResult,
  AgentListSessionsInput,
  AgentSessionSummaryPage,
} from "@/types/agent/SessionTypes.js";

/** 创建 Agent Session 的公开参数。 */
export interface AgentCreateSessionOptions extends AgentCreateSessionInput {
  /** 本次 Session 可选使用的 Workspace 资源；未传入时使用内存执行上下文。 */
  workspace?: WorkspaceBase;
}

/** 恢复 Agent Session 时使用的本地执行上下文。 */
export interface AgentGetSessionOptions {
  /** 当前 Session 使用的 Workspace；必须与持久化 Metadata 一致。 */
  workspace?: WorkspaceBase;
}

/** Agent 公开的 Session 创建入口。 */
export interface AgentSessionCollection {
  /** 在指定 Workspace 中创建一个属于当前 Agent 的 Session。 */
  create(options?: AgentCreateSessionOptions): Promise<AgentSession>;

  /** 在指定 Workspace 中恢复一个已经属于当前 Agent 的 Session。 */
  get(
    session_id: string,
    origin_type?: string,
    options?: AgentGetSessionOptions,
  ): Promise<AgentSession>;

  /** 列出当前 Agent 的活动 Session。 */
  list(input?: AgentListSessionsInput): Promise<AgentSessionSummaryPage>;

  /** 归档一个 Session。 */
  archive(input: AgentArchiveSessionInput): Promise<AgentArchiveSessionResult>;

  /** 列出已归档 Session。 */
  archived(input?: AgentArchiveSessionsInput): Promise<AgentArchiveSessionsResult>;

  /** 清空已归档 Session。 */
  clean_archive(): Promise<AgentCleanArchiveResult>;

  /** 获取 Session runtime port。 */
  runtime(session_id: string, origin_type?: string): SessionPort;

  /** 返回当前 Agent 正在执行的 Session 标识。 */
  list_executing_session_ids(): string[];

  /** 永久删除 Session。 */
  remove(session_id: string, origin_type?: string): Promise<boolean>;

  /** 清空 Session 消息。 */
  clear_messages(session_id: string, origin_type?: string): Promise<boolean>;
}
