/** LocalGroupSessionDataStore：GroupSession 的 metadata 与消息 JSONL 存储。 */

import path from "node:path";
import type { FileSystem } from "@downcity/workspace";
import type { GroupMessage } from "@/types/group/Group.js";
import type {
  GroupSessionDataStore,
  GroupSessionHistoryMeta,
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

  constructor(options: {
    /** 当前 Group StorageScope 文件能力。 */
    files: FileSystem;
    /** 当前 Group StorageScope 根路径。 */
    storage_root_path: string;
    /** 当前 GroupSession 标识。 */
    session_id: string;
    /** 所属 Group 标识。 */
    group_id: string;
  }) {
    this.files = options.files;
    this.group_id = options.group_id;
    this.session_id = String(options.session_id || "").trim();
    if (!this.session_id) throw new Error("GroupSession store requires a non-empty session_id");
    this.session_root_path = path.join(
      path.resolve(options.storage_root_path),
      "sessions",
      encodeURIComponent(this.session_id),
    );
    this.metadata_file_path = path.join(this.session_root_path, "meta.json");
    this.messages_file_path = path.join(this.session_root_path, "messages.jsonl");
    this.transaction_lock_path = path.join(this.session_root_path, ".lock");
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
    return await this.read_metadata_unlocked();
  }

  /** 在调用方已经持有事务锁时读取 metadata。 */
  private async read_metadata_unlocked(): Promise<GroupSessionHistoryMeta> {
    if (!(await this.files.path_exists(this.metadata_file_path))) {
      return this.create_initial_metadata();
    }
    const raw = JSON.parse(
      (await this.files.read_file(this.metadata_file_path)).toString("utf8"),
    ) as Partial<GroupSessionHistoryMeta>;
    if (raw.session_id !== this.session_id) {
      throw new Error(`Invalid GroupSession ownership metadata: ${this.session_id}`);
    }
    if (raw.group_id && raw.group_id !== this.group_id) {
      throw new Error(`GroupSession "${this.session_id}" belongs to another Group`);
    }
    return {
      v: 1,
      session_id: this.session_id,
      group_id: String(raw.group_id || this.group_id),
      ...(typeof raw.workspace_id === "string" && raw.workspace_id.trim() ? { workspace_id: raw.workspace_id.trim() } : {}),
      created_at: typeof raw.created_at === "number" ? raw.created_at : Date.now(),
      updated_at: typeof raw.updated_at === "number" ? raw.updated_at : 0,
      message_count: typeof raw.message_count === "number" ? raw.message_count : 0,
      ...(typeof raw.preview_text === "string" && raw.preview_text ? { preview_text: raw.preview_text } : {}),
      ...(raw.member_session_ids && typeof raw.member_session_ids === "object"
        ? { member_session_ids: normalize_member_session_ids(raw.member_session_ids) }
        : {}),
    };
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
        v: 1 as const,
      };
      await this.write_metadata_unlocked(next_metadata);
      return next_metadata;
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

  private create_initial_metadata(): GroupSessionHistoryMeta {
    const created_at = Date.now();
    return {
      v: 1,
      session_id: this.session_id,
      group_id: this.group_id,
      created_at,
      updated_at: created_at,
      message_count: 0,
    };
  }
}

function normalize_member_session_ids(input: object): Record<string, string> {
  return Object.fromEntries(Object.entries(input).filter(([agent_id, session_id]) => Boolean(agent_id.trim()) && typeof session_id === "string" && session_id.trim()));
}
