/**
 * Agent 面向 SDK 用户的 Session 集合类型。
 *
 * Session 归 Agent 所有；Workspace 是会话的当前目录，不是会话身份。
 */

import type { WorkspaceRuntime } from "@downcity/type";
import type { AgentSession } from "@/types/agent/SessionActor.js";
import type { AgentCreateSessionInput } from "@/types/agent/SessionTypes.js";
import type { SessionPort } from "@/types/session/SessionPort.js";
import type { SessionRemovalEvent } from "@/types/agent/SessionRemoval.js";
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
  /** 新 Session 的初始目录；省略时使用 Agent 的默认目录，两者都没有则无项目上下文。 */
  workspace?: WorkspaceRuntime;
}

/** 恢复 Agent Session 时使用的当前目录。 */
export interface AgentGetSessionOptions {
  /**
   * 恢复后要使用的当前目录。
   *
   * 关键点（中文）：这与持久化值不一致时不再报错，而是以该值为准成为该 Session 的当前目录，
   * 语义等同 `session.set({ workspace })`。省略时由 Agent 的 `resolve_workspace` 按持久化值还原。
   */
  workspace?: WorkspaceRuntime;
}

/** Agent 公开的 Session 创建入口。 */
export interface AgentSessionCollection {
  /**
   * 打开 Agent 自己的那段对话；不存在时创建。
   *
   * 关键点（中文）：它就是一条普通 Session，角色由 `origin.type = "agent"` 表达；
   * 一个 Agent 至多一条，被归档或删除后下一次调用自然重建。
   */
  /** 返回 Agent 自己的那条会话；不存在时创建。 */
  self(options?: AgentGetSessionOptions): Promise<AgentSession>;

  /** 在指定 Workspace 中创建一个属于当前 Agent 的 Session。 */
  create(options?: AgentCreateSessionOptions): Promise<AgentSession>;

  /** 监听本地新会话初始化完成；监听器完成后创建才返回，取消函数释放订阅。 */
  on_created(listener: (session: AgentSession) => void | Promise<void>): () => void;

  /** 监听成功归档或删除活动会话；监听器失败不回滚领域提交。 */
  on_removed(listener: (event: SessionRemovalEvent) => void | Promise<void>): () => void;

  /** 在指定 Workspace 中恢复一个已经属于当前 Agent 的 Session。 */
  get(
    session_id: string,
    category?: string,
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
  runtime(session_id: string, category?: string): SessionPort;

  /** 返回当前 Agent 正在执行的 Session 标识。 */
  list_executing_session_ids(): string[];

  /** 永久删除 Session。 */
  remove(session_id: string, category?: string): Promise<boolean>;

  /** 清空 Session 消息。 */
  clear_messages(session_id: string, category?: string): Promise<boolean>;

  /**
   * 释放一个空闲 Session 的运行时实例。
   *
   * 只影响内存缓存；消息与元数据仍在 Store 中，下次 `get()` 会重新恢复。
   * 正在执行的 Session 不会被释放，返回是否真的释放。
   * 调用方必须先解除对该实例的订阅，否则重新 `get()` 得到的新实例不会再被订阅。
   */
  release(session_id: string, category?: string): boolean;
}
