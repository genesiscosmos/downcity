/**
 * LocalAgentStore：Workspace 内本地 Agent 领域数据入口。
 *
 * 职责说明（中文）
 * - 统一管理 Session 创建判断、删除、列表、归档与清理。
 * - 缓存稳定的 LocalSessionStore，避免同一 Session 重复创建 Message Store。
 * - 当前阶段沿用既有本地目录布局；调用方和 Session 不感知该约定。
 */

import type {
  AgentArchiveSessionResult,
  AgentArchiveSessionsInput,
  AgentArchiveSessionsResult,
  AgentCleanArchiveResult,
  AgentListSessionsInput,
  AgentSessionSummaryPage,
} from "@/types/agent/SessionTypes.js";
import type { AgentStore } from "@/types/store/AgentStore.js";
import type { SessionStore } from "@/types/store/SessionStore.js";
import { LocalSessionStore } from "@/workspace/store/LocalSessionStore.js";
import {
  get_sdk_agent_archived_session_dir_path,
  get_sdk_agent_archived_sessions_dir_path,
  get_sdk_agent_session_dir_path,
  get_sdk_agent_session_messages_dir_path,
} from "@/workspace/store/LocalStorePaths.js";
import {
  listArchivedAgentSessionSummaryPage,
  listAgentSessionSummaryPage,
} from "@/session/browse/Browse.js";
import type { FileSystem } from "@/types/workspace/FileSystem.js";
import type { LocalAgentStoreOptions } from "@/types/store/LocalStore.js";

/** 解码目录中经过 URL 编码的 Session 标识。 */
function decode_session_id(input: string): string {
  try {
    return decodeURIComponent(input);
  } catch {
    return input;
  }
}

/** 默认本地 Agent Store。 */
export class LocalAgentStore implements AgentStore {
  /** 当前 Store 与 AgentTools 共用的 Workspace 文件能力。 */
  private readonly files: FileSystem;

  /** 当前 Agent 的稳定标识。 */
  private readonly agent_id: string;

  /** 已创建的 Session Store 缓存。 */
  private readonly sessions = new Map<string, LocalSessionStore>();

  constructor(options: LocalAgentStoreOptions) {
    this.files = options.files;
    this.agent_id = options.agent_id;
  }

  /** 返回指定 Session 的稳定持久化视图。 */
  session(session_id: string): SessionStore {
    const resolved_session_id = String(session_id || "").trim();
    if (!resolved_session_id) {
      throw new Error("AgentStore.session requires a non-empty session_id");
    }
    const cached = this.sessions.get(resolved_session_id);
    if (cached) return cached;
    const created = new LocalSessionStore({
      files: this.files,
      agent_id: this.agent_id,
      session_id: resolved_session_id,
    });
    this.sessions.set(resolved_session_id, created);
    return created;
  }

  /** 判断活动 Session 是否存在。 */
  async has_session(session_id: string): Promise<boolean> {
    return await this.files.path_exists(this.session_path(session_id));
  }

  /** 永久删除活动 Session。 */
  async remove_session(session_id: string): Promise<boolean> {
    const session_path = this.session_path(session_id);
    const existed = await this.files.path_exists(session_path);
    if (existed) await this.files.remove_path(session_path);
    this.sessions.delete(session_id);
    return existed;
  }

  /** 清空活动 Session Message 数据。 */
  async clear_session_messages(session_id: string): Promise<boolean> {
    const messages_path = get_sdk_agent_session_messages_dir_path(
      this.files.root_path,
      this.agent_id,
      session_id,
    );
    const existed = await this.files.path_exists(messages_path);
    if (existed) await this.files.remove_path(messages_path);
    this.sessions.delete(session_id);
    return existed;
  }

  /** 返回活动 Session 摘要页。 */
  async list_sessions(
    input: AgentListSessionsInput | undefined,
    executing_session_ids: ReadonlySet<string>,
  ): Promise<AgentSessionSummaryPage> {
    return await listAgentSessionSummaryPage({
      projectRoot: this.files.root_path,
      agentId: this.agent_id,
      input,
      executingSessionIds: new Set(executing_session_ids),
      files: this.files,
    });
  }

  /** 将活动 Session 迁入归档区。 */
  async archive_session(session_id: string): Promise<AgentArchiveSessionResult> {
    const source_path = this.session_path(session_id);
    if (!(await this.files.path_exists(source_path))) {
      throw new Error(`Session "${session_id}" not found`);
    }
    const target_path = get_sdk_agent_archived_session_dir_path(
      this.files.root_path,
      this.agent_id,
      session_id,
    );
    if (await this.files.path_exists(target_path)) {
      throw new Error(`Archived session "${session_id}" already exists`);
    }
    await this.files.ensure_directory(get_sdk_agent_archived_sessions_dir_path(
      this.files.root_path,
      this.agent_id,
    ));
    await this.files.move_path(source_path, target_path);
    this.sessions.delete(session_id);
    return {
      sessionId: session_id,
      archivedAt: Date.now(),
    };
  }

  /** 返回归档 Session 摘要页。 */
  async list_archived_sessions(
    input?: AgentArchiveSessionsInput,
  ): Promise<AgentArchiveSessionsResult> {
    return await listArchivedAgentSessionSummaryPage({
      projectRoot: this.files.root_path,
      agentId: this.agent_id,
      input,
      files: this.files,
    });
  }

  /** 永久删除全部归档 Session。 */
  async clean_archive(): Promise<AgentCleanArchiveResult> {
    const archive_path = get_sdk_agent_archived_sessions_dir_path(
      this.files.root_path,
      this.agent_id,
    );
    if (!(await this.files.path_exists(archive_path))) {
      return { removedSessionIds: [] };
    }
    const entries = await this.files.read_directory(archive_path);
    const removed_session_ids: string[] = [];
    for (const entry of entries) {
      if (!entry.is_directory) continue;
      const session_id = decode_session_id(entry.name);
      if (!session_id) continue;
      await this.files.remove_path(get_sdk_agent_archived_session_dir_path(
        this.files.root_path,
        this.agent_id,
        session_id,
      ));
      removed_session_ids.push(session_id);
    }
    return { removedSessionIds: removed_session_ids };
  }

  /** 本地 JSONL Store 当前没有常驻句柄。 */
  async dispose(): Promise<void> {}

  /** 返回活动 Session 物理目录，仅供本地实现内部使用。 */
  private session_path(session_id: string): string {
    return get_sdk_agent_session_dir_path(
      this.files.root_path,
      this.agent_id,
      session_id,
    );
  }
}
