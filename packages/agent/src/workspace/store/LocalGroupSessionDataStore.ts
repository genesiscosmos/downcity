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
  }

  /** 初始化当前 GroupSession 目录与 metadata。 */
  async initialize(): Promise<void> {
    await this.files.ensure_directory(this.session_root_path);
    if (!(await this.files.path_exists(this.metadata_file_path))) {
      await this.write_metadata(this.create_initial_metadata());
    }
  }

  /** 读取完整共享消息历史。 */
  async list_messages(): Promise<GroupMessage[]> {
    if (!(await this.files.path_exists(this.messages_file_path))) return [];
    const content = (await this.files.read_file(this.messages_file_path)).toString("utf8");
    return content
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as GroupMessage);
  }

  /** 追加一条消息并更新 metadata。 */
  async append_message(message: GroupMessage): Promise<void> {
    if (message.group_id !== this.group_id) {
      throw new Error(`GroupSession message belongs to another Group: ${this.session_id}`);
    }
    await this.initialize();
    await this.files.with_file_lock(`${this.messages_file_path}.lock`, async () => {
      await this.files.append_file(this.messages_file_path, `${JSON.stringify(message)}\n`);
      const metadata = await this.read_metadata();
      await this.write_metadata({
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
    const raw = JSON.parse(
      (await this.files.read_file(this.metadata_file_path)).toString("utf8"),
    ) as Partial<GroupSessionHistoryMeta>;
    if (raw.session_id !== this.session_id) {
      throw new Error(`Invalid GroupSession ownership metadata: ${this.session_id}`);
    }
    return {
      v: 1,
      session_id: this.session_id,
      group_id: String(raw.group_id || this.group_id),
      created_at: typeof raw.created_at === "number" ? raw.created_at : Date.now(),
      updated_at: typeof raw.updated_at === "number" ? raw.updated_at : 0,
      message_count: typeof raw.message_count === "number" ? raw.message_count : 0,
      ...(typeof raw.preview_text === "string" && raw.preview_text ? { preview_text: raw.preview_text } : {}),
    };
  }

  /** 原子写入当前 metadata。 */
  async write_metadata(metadata: GroupSessionHistoryMeta): Promise<void> {
    if (metadata.session_id !== this.session_id || metadata.group_id !== this.group_id) {
      throw new Error(`Invalid GroupSession metadata ownership: ${this.session_id}`);
    }
    await this.files.ensure_directory(this.session_root_path);
    await this.files.write_file_atomically(
      this.metadata_file_path,
      `${JSON.stringify(metadata, null, 2)}\n`,
    );
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
