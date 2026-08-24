/**
 * LocalSessionDataStore：Agent 内单个 Session 的 JSONL 持久化视图。
 *
 * 职责说明（中文）
 * - 集中创建 Message Store，并封装 Metadata 与 Instruction 的物理路径。
 * - Session 领域只持有本对象，不再自行拼接任何存储路径。
 */

import { JsonlSessionMessageStore } from "@/workspace/store/JsonlSessionMessageStore.js";
import {
  get_workspace_session_instruction_path,
  get_workspace_session_meta_path,
  get_workspace_session_assistant_message_path,
  get_workspace_session_active_messages_path,
  get_workspace_session_attachments_path,
} from "@/workspace/store/LocalStorePaths.js";
import { normalize_session_metadata } from "@/session/storage/Metadata.js";
import type { SessionHistoryMetaV1 } from "@/executor/types/SessionHistoryMeta.js";
import type { SessionDataStore } from "@/types/store/SessionDataStore.js";
import type { FileSystem } from "@downcity/workspace";
import type { LocalSessionDataStoreOptions } from "@/types/store/LocalStore.js";
import { LocalSessionAttachmentStore } from "@/workspace/store/LocalSessionAttachmentStore.js";

/** 本地 Session Store。 */
export class LocalSessionDataStore implements SessionDataStore {
  /** 当前 Session 的稳定标识。 */
  readonly session_id: string;

  /** 当前 Session 的 JSONL Message Store。 */
  readonly messages: JsonlSessionMessageStore;

  /** 当前 Session 的附件持久化能力。 */
  readonly attachments: LocalSessionAttachmentStore;

  /** 当前 Agent 内部数据文件能力。 */
  private readonly files: FileSystem;

  /** 当前 Agent 的稳定标识。 */
  private readonly agent_id: string;

  /** 当前 Workspace 的稳定标识。 */
  private readonly workspace_id?: string;

  /** 当前 Agent 内部数据根路径。 */
  private readonly storage_root_path: string;

  constructor(options: LocalSessionDataStoreOptions) {
    this.files = options.files;
    this.agent_id = options.agent_id;
    this.workspace_id = options.workspace_id;
    this.storage_root_path = options.storage_root_path;
    this.session_id = options.session_id;
    this.messages = new JsonlSessionMessageStore({
      files: this.files,
      session_id: this.session_id,
      file_path: get_workspace_session_active_messages_path(
        this.storage_root_path,
        this.session_id,
      ),
      assistant_message_file_path: get_workspace_session_assistant_message_path(
        this.storage_root_path,
        this.session_id,
      ),
    });
    this.attachments = new LocalSessionAttachmentStore({
      files: this.files,
      attachments_dir_path: get_workspace_session_attachments_path(
        this.storage_root_path,
        this.session_id,
      ),
    });
  }

  /** 读取规范化 Session Metadata。 */
  async read_metadata(): Promise<SessionHistoryMetaV1> {
    try {
      const raw = JSON.parse(
        (await this.files.read_file(this.metadata_path())).toString("utf8"),
      ) as Partial<SessionHistoryMetaV1>;
      const metadata = normalize_session_metadata(
        raw,
        this.session_id,
        this.agent_id,
        this.workspace_id,
      );
      if (raw.agent_id !== this.agent_id) {
        throw new Error(
          `Session "${this.session_id}" belongs to another Agent`,
        );
      }
      return metadata;
    } catch {
      if (await this.files.path_exists(this.metadata_path())) {
        throw new Error(
          `Invalid Session ownership metadata: ${this.session_id}`,
        );
      }
      return normalize_session_metadata(
        {},
        this.session_id,
        this.agent_id,
        this.workspace_id,
      );
    }
  }

  /** 写入完整 Session Metadata。 */
  async write_metadata(metadata: SessionHistoryMetaV1): Promise<void> {
    const normalized = normalize_session_metadata(
      metadata,
      this.session_id,
      this.agent_id,
      this.workspace_id,
    );
    const metadata_path = this.metadata_path();
    await this.files.with_file_lock(`${metadata_path}.lock`, async () => {
      if (await this.files.path_exists(metadata_path)) {
        const existing = JSON.parse(
          (await this.files.read_file(metadata_path)).toString("utf8"),
        ) as Partial<SessionHistoryMetaV1>;
        if (existing.session_id !== this.session_id || existing.agent_id !== this.agent_id) {
          throw new Error(
            `Session "${this.session_id}" belongs to another Agent`,
          );
        }
      }
      await this.files.write_file_atomically(
        metadata_path,
        `${JSON.stringify(normalized, null, 2)}\n`,
      );
    });
  }

  /** 判断显式 system 快照是否存在。 */
  async has_instruction(): Promise<boolean> {
    return await this.files.path_exists(this.instruction_path());
  }

  /** 读取显式 system 快照。 */
  async read_instruction(): Promise<string | null> {
    if (!(await this.has_instruction())) return null;
    return (await this.files.read_file(this.instruction_path())).toString("utf8");
  }

  /** 写入显式 system 快照。 */
  async write_instruction(instruction: string): Promise<void> {
    const instruction_path = get_workspace_session_instruction_path(
      this.storage_root_path,
      this.session_id,
    );
    await this.files.write_file_atomically(instruction_path, instruction);
  }

  /** 返回当前 Session instruction.md 的 Workspace 路径。 */
  private instruction_path(): string {
    return get_workspace_session_instruction_path(
      this.storage_root_path,
      this.session_id,
    );
  }

  /** 返回当前 Session meta.json 的 Workspace 路径。 */
  private metadata_path(): string {
    return get_workspace_session_meta_path(
      this.storage_root_path,
      this.session_id,
    );
  }
}
