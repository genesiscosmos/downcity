/** LocalGroupSessionDataStore：GroupSession 的 metadata 与消息 JSONL 存储。 */

import path from "node:path";
import type { FileSystem } from "@downcity/type";
import type { GroupMessage } from "@/types/group/Group.js";
import type {
  GroupDispatchTurnRecord,
  GroupDispatchTurnStatus,
} from "@/types/group/GroupDispatch.js";
import type {
  GroupSessionDataStore,
  GroupSessionHistoryMeta,
  GroupSessionTurnCheckpoint,
} from "@/types/group/GroupSessionStore.js";

/** 单个 GroupSession 的本地文件存储。 */
export class LocalGroupSessionDataStore implements GroupSessionDataStore {
  readonly session_id: string;
  private readonly files: FileSystem;
  private readonly group_id: string;
  private readonly session_root_path: string;
  private readonly metadata_file_path: string;
  private readonly messages_file_path: string;
  private readonly transaction_lock_path: string;
  private readonly dispatch_root_path: string;
  private readonly dispatch_turns_file_path: string;
  private readonly dispatch_lock_path: string;

  constructor(options: {
    /** 当前 Group StorageScope 文件能力。 */
    files: FileSystem;
    /** 当前 Group StorageScope 根路径。 */
    storage_root_path: string;
    /** 当前 GroupSession 标识。 */
    session_id: string;
    /** 所属 Group 标识。 */
    group_id: string;
    /**
     * 当前 Session 所在的存储区。
     *
     * 默认 `active`（`sessions/`）；归档后的 Session 住在 `archived-sessions/`。
     * 区由调用方给而不是在这里判断：DataStore 只负责“某个目录里的一个 Session”，
     * 该在哪个区是集合层的事。
     */
    area?: "active" | "archived";
  }) {
    this.files = options.files;
    this.group_id = options.group_id;
    this.session_id = String(options.session_id || "").trim();
    if (!this.session_id) throw new Error("GroupSession store requires a non-empty session_id");
    this.session_root_path = path.join(
      path.resolve(options.storage_root_path),
      options.area === "archived" ? "archived-sessions" : "sessions",
      encodeURIComponent(this.session_id),
    );
    this.metadata_file_path = path.join(this.session_root_path, "meta.json");
    this.messages_file_path = path.join(this.session_root_path, "messages.jsonl");
    this.transaction_lock_path = path.join(this.session_root_path, ".lock");
    this.dispatch_root_path = path.join(this.session_root_path, "dispatch");
    this.dispatch_turns_file_path = path.join(this.dispatch_root_path, "turns.jsonl");
    this.dispatch_lock_path = path.join(this.dispatch_root_path, ".lock");
  }

  /** 初始化当前 GroupSession 目录与 metadata。 */
  async initialize(): Promise<void> {
    await this.files.ensure_directory(this.session_root_path);
    await this.files.with_file_lock(this.transaction_lock_path, async () => {
      if (!(await this.files.path_exists(this.metadata_file_path))) {
        await this.write_metadata_unlocked(this.create_initial_metadata());
      }
      await this.repair_metadata_unlocked();
    });
  }

  /** 读取完整共享消息历史。 */
  async list_messages(): Promise<GroupMessage[]> {
    return await this.read_messages();
  }

  /** 追加一条消息并更新 metadata。 */
  async append_message(message: GroupMessage): Promise<void> {
    if (message.group_id !== this.group_id) {
      throw new Error(`GroupSession message belongs to another Group: ${this.session_id}`);
    }
    await this.initialize();
    await this.files.with_file_lock(this.transaction_lock_path, async () => {
      await this.files.append_file(this.messages_file_path, `${JSON.stringify(message)}\n`);
      const metadata = await this.read_metadata_unlocked();
      await this.write_metadata_unlocked({
        ...metadata,
        updated_at: message.created_at,
        message_count: metadata.message_count + 1,
        preview_text: message.text,
      });
    });
  }

  /** 读取当前 metadata。 */
  async read_metadata(): Promise<GroupSessionHistoryMeta> {
    if (!(await this.files.path_exists(this.metadata_file_path))) {
      return this.create_initial_metadata();
    }
    return await this.files.with_file_lock(
      this.transaction_lock_path,
      async () => await this.read_metadata_unlocked(),
    );
  }

  /** 在调用方已经持有事务锁时读取 metadata。 */
  private async read_metadata_unlocked(): Promise<GroupSessionHistoryMeta> {
    if (!(await this.files.path_exists(this.metadata_file_path))) {
      return this.create_initial_metadata();
    }
    const raw = JSON.parse(
      (await this.files.read_file(this.metadata_file_path)).toString("utf8"),
    ) as Omit<Partial<GroupSessionHistoryMeta>, "v" | "pending_turns"> & {
      readonly v?: unknown;
      readonly pending_turns?: unknown[];
    };
    if (raw.v !== 1 && raw.v !== 2) {
      throw new Error(`Unsupported GroupSession metadata version: ${String(raw.v)}`);
    }
    if (raw.session_id !== this.session_id) {
      throw new Error(`Invalid GroupSession ownership metadata: ${this.session_id}`);
    }
    if (raw.group_id && raw.group_id !== this.group_id) {
      throw new Error(`GroupSession "${this.session_id}" belongs to another Group`);
    }
    const metadata: GroupSessionHistoryMeta = {
      v: 2,
      session_id: this.session_id,
      group_id: String(raw.group_id || this.group_id),
      ...(typeof raw.workspace_id === "string" && raw.workspace_id.trim() ? { workspace_id: raw.workspace_id.trim() } : {}),
      ...(typeof raw.title === "string" && raw.title.trim() ? { title: raw.title.trim() } : {}),
      created_at: typeof raw.created_at === "number" ? raw.created_at : Date.now(),
      updated_at: typeof raw.updated_at === "number" ? raw.updated_at : 0,
      message_count: typeof raw.message_count === "number" ? raw.message_count : 0,
      ...(typeof raw.preview_text === "string" && raw.preview_text ? { preview_text: raw.preview_text } : {}),
      ...(raw.member_session_ids && typeof raw.member_session_ids === "object"
        ? { member_session_ids: normalize_member_session_ids(raw.member_session_ids) }
        : {}),
      ...(Array.isArray(raw.pending_turns)
        ? { pending_turns: normalize_pending_turns(raw.pending_turns, raw.v === 1 ? "auto" : undefined) }
        : {}),
      ...(Array.isArray(raw.auto_frontier_message_ids)
        ? { auto_frontier_message_ids: normalize_message_ids(raw.auto_frontier_message_ids) }
        : {}),
    };
    if (raw.v === 1) await this.write_metadata_unlocked(metadata);
    return metadata;
  }

  /** 原子写入当前 metadata。 */
  async write_metadata(metadata: GroupSessionHistoryMeta): Promise<void> {
    await this.files.with_file_lock(this.transaction_lock_path, async () => {
      await this.write_metadata_unlocked(metadata);
    });
  }

  /** 在调用方已经持有事务锁时写入 metadata。 */
  private async write_metadata_unlocked(metadata: GroupSessionHistoryMeta): Promise<void> {
    if (metadata.session_id !== this.session_id || metadata.group_id !== this.group_id) {
      throw new Error(`Invalid GroupSession metadata ownership: ${this.session_id}`);
    }
    await this.files.ensure_directory(this.session_root_path);
    await this.files.write_file_atomically(
      this.metadata_file_path,
      `${JSON.stringify(metadata, null, 2)}\n`,
    );
  }

  /** 在文件锁内合并 metadata，避免消息追加和成员映射互相覆盖。 */
  async update_metadata(patch: Partial<GroupSessionHistoryMeta>): Promise<GroupSessionHistoryMeta> {
    await this.initialize();
    return await this.files.with_file_lock(this.transaction_lock_path, async () => {
      const next_metadata = {
        ...(await this.read_metadata_unlocked()),
        ...patch,
        session_id: this.session_id,
        group_id: this.group_id,
        v: 2 as const,
      };
      await this.write_metadata_unlocked(next_metadata);
      return next_metadata;
    });
  }

  /** 读取每个 dispatch_id 最后一次成功提交的调度状态。 */
  async list_dispatch_turns(): Promise<GroupDispatchTurnRecord[]> {
    if (!(await this.files.path_exists(this.dispatch_turns_file_path))) return [];
    await this.files.ensure_directory(this.dispatch_root_path);
    return await this.files.with_file_lock(this.dispatch_lock_path, async () => {
      const records = await this.read_dispatch_records(true);
      const turns_by_id = new Map<string, GroupDispatchTurnRecord>();
      for (const record of records) {
        turns_by_id.delete(record.dispatch_id);
        turns_by_id.set(record.dispatch_id, record);
      }
      return [...turns_by_id.values()];
    });
  }

  /** 向 GroupSession 私有调度日志追加一个完整状态快照。 */
  async append_dispatch_turn(turn: GroupDispatchTurnRecord): Promise<void> {
    assert_dispatch_turn(turn);
    await this.files.ensure_directory(this.dispatch_root_path);
    await this.files.with_file_lock(this.dispatch_lock_path, async () => {
      await this.files.append_file(this.dispatch_turns_file_path, `${JSON.stringify(turn)}\n`);
    });
  }

  /** 校验消息日志并由真实消息重建可恢复的摘要字段。 */
  private async repair_metadata_unlocked(): Promise<void> {
    const messages = await this.read_messages(true);
    const metadata = await this.read_metadata_unlocked();
    const first_message = messages[0];
    const last_message = messages[messages.length - 1];
    await this.write_metadata_unlocked({
      ...metadata,
      created_at: first_message?.created_at || metadata.created_at,
      updated_at: last_message?.created_at || metadata.updated_at,
      message_count: messages.length,
      ...(last_message?.text ? { preview_text: last_message.text } : {}),
    });
  }

  /** 读取 JSONL；仅允许自动修复文件尾部不完整的一行。 */
  private async read_messages(repair_tail = false): Promise<GroupMessage[]> {
    if (!(await this.files.path_exists(this.messages_file_path))) return [];
    const content = (await this.files.read_file(this.messages_file_path)).toString("utf8");
    const lines = content.split("\n");
    const messages: GroupMessage[] = [];
    for (let line_index = 0; line_index < lines.length; line_index += 1) {
      const line = lines[line_index];
      if (!line.trim()) continue;
      let message: GroupMessage;
      try {
        message = JSON.parse(line) as GroupMessage;
      } catch (error) {
        const is_tail = lines.slice(line_index + 1).every((item) => !item.trim());
        if (!repair_tail || !is_tail) throw error;
        const repaired_content = messages.map((item) => JSON.stringify(item)).join("\n");
        await this.files.write_file_atomically(this.messages_file_path, repaired_content ? `${repaired_content}\n` : "");
        break;
      }
      if (message.group_id !== this.group_id) {
        throw new Error(`GroupSession message belongs to another Group: ${this.session_id}`);
      }
      messages.push(message);
    }
    return messages;
  }

  /** 读取调度状态日志；只允许修复进程中断产生的最后一条残缺记录。 */
  private async read_dispatch_records(repair_tail: boolean): Promise<GroupDispatchTurnRecord[]> {
    const content = (await this.files.read_file(this.dispatch_turns_file_path)).toString("utf8");
    const lines = content.split("\n");
    const records: GroupDispatchTurnRecord[] = [];
    for (let line_index = 0; line_index < lines.length; line_index += 1) {
      const line = lines[line_index];
      if (!line.trim()) continue;
      try {
        const record = JSON.parse(line) as GroupDispatchTurnRecord;
        assert_dispatch_turn(record);
        records.push(record);
      } catch (error) {
        const is_tail = lines.slice(line_index + 1).every((item) => !item.trim());
        if (!repair_tail || !is_tail) throw error;
        const repaired = records.map((record) => JSON.stringify(record)).join("\n");
        await this.files.write_file_atomically(
          this.dispatch_turns_file_path,
          repaired ? `${repaired}\n` : "",
        );
        break;
      }
    }
    return records;
  }

  private create_initial_metadata(): GroupSessionHistoryMeta {
    const created_at = Date.now();
    return {
      v: 2,
      session_id: this.session_id,
      group_id: this.group_id,
      created_at,
      updated_at: created_at,
      message_count: 0,
    };
  }
}

const dispatch_turn_statuses = new Set<GroupDispatchTurnStatus>([
  "queued",
  "running",
  "completed",
  "failed",
  "stopped",
]);

/** 防止损坏的持久化记录进入 GroupSession 调度恢复流程。 */
function assert_dispatch_turn(value: GroupDispatchTurnRecord): void {
  if (!value || typeof value !== "object") throw new Error("Invalid Group dispatch turn record");
  if (typeof value.dispatch_id !== "string" || !value.dispatch_id.trim()) {
    throw new Error("Invalid Group dispatch turn id");
  }
  if (value.trigger !== "user" && value.trigger !== "auto") {
    throw new Error(`Invalid Group dispatch trigger: ${String(value.trigger)}`);
  }
  if (typeof value.message_id !== "string" || !value.message_id.trim()) {
    throw new Error(`Invalid Group dispatch message id: ${value.dispatch_id}`);
  }
  if (
    !Array.isArray(value.pending_message_ids)
    || value.pending_message_ids.some((item) => typeof item !== "string" || !item.trim())
  ) {
    throw new Error(`Invalid Group dispatch pending messages: ${value.dispatch_id}`);
  }
  if (!dispatch_turn_statuses.has(value.status)) {
    throw new Error(`Invalid Group dispatch status: ${String(value.status)}`);
  }
  if (!Number.isFinite(value.created_at) || !Number.isFinite(value.updated_at)) {
    throw new Error(`Invalid Group dispatch timestamps: ${value.dispatch_id}`);
  }
  if (value.status === "completed" && !value.decision) {
    throw new Error(`Completed Group dispatch is missing its decision: ${value.dispatch_id}`);
  }
}

function normalize_member_session_ids(input: object): Record<string, string> {
  return Object.fromEntries(Object.entries(input).filter(([agent_id, session_id]) => Boolean(agent_id.trim()) && typeof session_id === "string" && session_id.trim()));
}

function normalize_pending_turns(
  input: unknown[],
  default_dispatch_stage?: GroupSessionTurnCheckpoint["dispatch_stage"],
): GroupSessionTurnCheckpoint[] {
  return input.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const candidate = item as Partial<GroupSessionTurnCheckpoint>;
    const turn_id = typeof candidate.turn_id === "string" ? candidate.turn_id.trim() : "";
    const root_message_id = typeof candidate.root_message_id === "string" ? candidate.root_message_id.trim() : "";
    const context_message_ids = Array.isArray(candidate.context_message_ids)
      ? normalize_message_ids(candidate.context_message_ids)
      : [];
    const dispatch_stage = candidate.dispatch_stage === "user" || candidate.dispatch_stage === "auto"
      ? candidate.dispatch_stage
      : default_dispatch_stage;
    return turn_id && root_message_id && dispatch_stage
      ? [{ turn_id, root_message_id, context_message_ids, dispatch_stage }]
      : [];
  });
}

function normalize_message_ids(input: unknown[]): string[] {
  return [...new Set(input.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean))];
}
