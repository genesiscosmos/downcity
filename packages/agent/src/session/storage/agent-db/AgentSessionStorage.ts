/**
 * 单 Session 的正式 Agent DB facade。
 *
 * 视图持有稳定 session_id 和 Session 范围能力，所有 SQL/事务都在共享存储 Worker 中
 * 执行。附件使用记录身份，归档后重建逻辑 ID 不共用附件。视图关闭仅封闭当前句柄，
 * 共享连接由 Agent SessionStore 的独立租约释放。
 */
import path from "node:path";
import { randomUUID as random_uuid } from "node:crypto";
import { isDeepStrictEqual as is_deep_strict_equal } from "node:util";
import type { SessionAgentMessage, SessionMessage, SessionUserMessage } from "@downcity/type";
import { restore_session_origin } from "@downcity/type";
import type { SessionStorage, SessionMessageCreateInput, SessionMessageUpdate, SessionDerivedStore, SessionMessageStorageStats } from "@/types/store/SessionStorage.js";
import type { SessionHistoryMeta } from "@/types/store/SessionHistoryMeta.js";
import type { AgentSessionRecord, AgentSessionConfigurationRow } from "@/types/store/AgentSessionDatabase.js";
import type { AgentSessionMessagePage, AgentSessionMessageCommit } from "@/types/store/AgentSessionMessages.js";
import type { AgentSessionStorageOptions } from "@/types/store/AgentSessionStorage.js";
import type { SessionModelBinding } from "@/types/store/SessionModelBinding.js";
import type { SessionExecutionProfileReference } from "@/types/agent/SessionExecutionProfile.js";
import type { AgentSessionConfigurationUpdate } from "@/types/store/AgentSessionConfiguration.js";
import { LocalSessionAttachmentStore } from "../LocalSessionAttachmentStore.js";
import { decode_model_binding } from "../ModelBindingCodec.js";
import { resolve_system_timezone } from "../Metadata.js";

/** 不拥有数据库连接的 Session 范围视图。 */
export class AgentSessionStorage implements SessionStorage {
  readonly session_id: string;
  readonly origin: AgentSessionStorageOptions["origin"];
  private record?: AgentSessionRecord;
  private pending?: Promise<void>;
  private disposed = false;
  private readonly create_operation_id = random_uuid();
  private readonly created_at = Date.now();

  constructor(private readonly options: AgentSessionStorageOptions) {
    this.session_id = options.session_id;
    this.origin = structuredClone(options.origin);
    this.record = options.record;
  }


  /** 附件路径只含不可变记录身份，不随归档变化。 */
  get attachments(): LocalSessionAttachmentStore {
    return new LocalSessionAttachmentStore({ files: this.options.files,
      attachments_dir_path: path.join(this.options.storage_root_path, "session-files", this.session_id, "attachments") });
  }

  async initialize(): Promise<void> {
    if (this.disposed) throw new Error("session_storage_closed");
    if (!this.pending) this.pending = this.initialize_record().catch(error => { this.pending = undefined; throw error; });
    await this.pending;
  }

  private async initialize_record(): Promise<void> {
    if (!this.record) {
      let found: AgentSessionRecord | null = null;
      try { found = await this.options.lease.read({ command: "find", address: { archived: false, category: this.origin.category, session_id: this.session_id } }); }
      catch (error) { if (!(error instanceof Error) || error.message !== "session_storage_not_found") throw error; }
      if (!found) {
        await this.options.lease.write("collection", { command: "create", operation_id: this.create_operation_id, input: {
          session_id: this.session_id, origin: this.origin,
          workspace_id: this.options.workspace_id, timezone: resolve_system_timezone(), created_at: this.created_at,
        } });
        found = await this.options.lease.read({ command: "record", session_id: this.session_id });
      }
      this.record = found!;
    }
    if (this.record.session_id !== this.session_id || !is_deep_strict_equal(JSON.parse(this.record.origin), this.origin)) {
      throw new Error("session_storage_identity_conflict");
    }
  }

  async read_metadata(): Promise<SessionHistoryMeta> {
    await this.initialize();
    const row = await this.options.lease.read<AgentSessionRecord>({ command: "record", session_id: this.session_id });
    const config = await this.configuration();
    return { v: 2, session_id: row.session_id, agent_id: this.options.agent_id,
      origin: restore_session_origin(JSON.parse(row.origin), row.category), timezone: row.timezone,
      created_at: row.created_at, updated_at: row.updated_at, message_count: row.message_count,
      ...(row.workspace_id ? { workspace_id: row.workspace_id } : {}), ...(row.title ? { title: row.title } : {}),
      ...(row.model_label ? { model_label: row.model_label } : {}), ...(row.preview_text ? { preview_text: row.preview_text } : {}),
      ...(config.approval_mode ? { approval_mode: config.approval_mode } : {}),
      ...(config.execution_profile ? { execution_profile: JSON.parse(config.execution_profile) as SessionExecutionProfileReference } : {}),
    };
  }

  async write_metadata(metadata: SessionHistoryMeta): Promise<void> {
    if (metadata.session_id !== this.session_id || metadata.agent_id !== this.options.agent_id
      || !is_deep_strict_equal(metadata.origin, this.origin)) throw new Error("session_storage_identity_conflict");
    const current = await this.read_metadata();
    if (metadata.workspace_id !== current.workspace_id) throw new Error("session_workspace_immutable");
    await this.configure({ title: metadata.title ?? null,
      model_label: metadata.model_label ?? null, timezone: metadata.timezone ?? resolve_system_timezone(),
      approval_mode: metadata.approval_mode ?? null });
  }

  async read_model_binding(): Promise<SessionModelBinding | undefined> {
    const row = await this.configuration();
    return row.model_binding ? decode_model_binding(row.model_binding) : undefined;
  }
  async write_model_binding(binding: SessionModelBinding): Promise<void> { await this.configure({ model_binding: binding }); }
  async bind_execution_profile(reference: SessionExecutionProfileReference): Promise<void> { await this.configure({ execution_profile: reference }); }
  async has_instruction(): Promise<boolean> { return (await this.read_instruction()) !== null; }
  async read_instruction(): Promise<string | null> { return (await this.configuration()).system_snapshot; }
  async write_instruction(instruction: string): Promise<void> { await this.configure({ system_snapshot: instruction }); }

  async list_messages(): Promise<SessionMessage[]> {
    const items: SessionMessage[] = [];
    let before_sequence: number | undefined;
    while (true) {
      const page = await this.list_message_page({ before_sequence, limit: 200 });
      items.unshift(...page);
      if (page.length < 200) return items;
      before_sequence = page[0].sequence;
    }
  }
  /** 只接收输入版本和附件引用，完整 canonical 正文保留在存储拥有者侧。 */
  async read_input_versions(): Promise<import("@/types/store/SessionInputVersions.js").SessionInputVersions> {
    await this.initialize();
    return await this.options.lease.read({ command: "input_versions", session_id: this.session_id });
  }
  async has_attachment(file_path: string): Promise<boolean> {
    await this.initialize(); return await this.options.lease.read({ command: "has_attachment", session_id: this.session_id, file_path });
  }
  async read_message(message_id: string): Promise<SessionMessage | null> {
    await this.initialize(); return await this.options.lease.read({ command: "message", session_id: this.session_id, id: message_id });
  }
  async read_part_message(part_id: string): Promise<SessionMessage | null> {
    await this.initialize(); return await this.options.lease.read({ command: "part_message", session_id: this.session_id, id: part_id });
  }
  async read_inbox(inbox_id: string): ReturnType<SessionStorage["read_inbox"]> {
    await this.initialize();
    const message = await this.options.lease.read<SessionMessage | null>({ command: "inbox_message", session_id: this.session_id, id: inbox_id });
    if (!message || message.role !== "agent") return null;
    const part = message.parts.find(part => part.type === "inbox" && part.inbox_id === inbox_id);
    if (!part || part.type !== "inbox") throw new Error("session_inbox_invalid");
    return { message, part };
  }
  async read_first_user_message(): Promise<SessionUserMessage | null> {
    await this.initialize();
    return await this.options.lease.read({ command: "first_user", session_id: this.session_id });
  }
  async create_message(message: SessionMessageCreateInput, options?: import("@/types/store/SessionStorage.js").SessionMessageCreateOptions): Promise<SessionMessage> {
    await this.initialize();
    const candidate = structuredClone(message);
    const commit = await this.options.lease.write<AgentSessionMessageCommit>(this.session_id, {
      command: "append", input: { operation_id: random_uuid(), session_id: this.session_id, message: candidate },
    }, { assert_dispatchable: options?.assert_receivable });
    return { ...candidate, sequence: commit.sequence } as SessionMessage;
  }
  async update_message(input: SessionMessageUpdate): Promise<void> {
    await this.initialize();
    await this.options.lease.write(this.session_id, { command: "update", input: {
      operation_id: random_uuid(), session_id: this.session_id, message: input.message,
      changed_parts: input.changed_parts as SessionMessage["parts"], expected_revision: input.expected_revision,
    } }, { assert_dispatchable: input.assert_receivable });
  }
  async list_message_page(input?: { before_sequence?: number; limit?: number }): Promise<SessionMessage[]> {
    await this.initialize();
    return (await this.options.lease.read<AgentSessionMessagePage>({ command: "messages", session_id: this.session_id, input: input ?? {} })).items;
  }
  async list_recoverable_agent_messages(): Promise<SessionAgentMessage[]> {
    await this.initialize(); return await this.options.lease.read({ command: "recoverable", session_id: this.session_id });
  }
  async read_latest_agent_message(turn_id?: string): Promise<SessionAgentMessage | null> {
    await this.initialize();
    return await this.options.lease.read({ command: "latest_agent", session_id: this.session_id, turn_id });
  }
  async message_count(): Promise<number> { return (await this.read_metadata()).message_count ?? 0; }
  async message_stats(): Promise<SessionMessageStorageStats> {
    await this.initialize();
    return await this.options.lease.read({ command: "message_stats", session_id: this.session_id });
  }
  async truncate_messages(through_sequence: number): Promise<void> {
    await this.initialize(); await this.options.lease.write(this.session_id, { command: "truncate", input: {
      operation_id: random_uuid(), session_id: this.session_id, through_sequence,
    } });
  }
  async clear_messages(): Promise<void> { await this.truncate_messages(0); }
  derived_store(namespace: string): SessionDerivedStore {
    if (!/^[a-z][a-z0-9_]{0,63}$/u.test(namespace)) throw new Error("session_composer_namespace_invalid");
    return {
      read_checkpoint: async (schema_version) => { await this.initialize(); return await this.options.lease.read({ command: "checkpoint", session_id: this.session_id, namespace, schema_version }); },
      insert_checkpoint: async (checkpoint) => { await this.initialize(); await this.options.lease.write(this.session_id, { command: "checkpoint_insert", input: {
        ...checkpoint, operation_id: random_uuid(), session_id: this.session_id, namespace,
      } }); },
    };
  }
  async dispose(): Promise<void> { this.disposed = true; }

  private async configuration(): Promise<AgentSessionConfigurationRow> {
    await this.initialize(); return await this.options.lease.read({ command: "configuration", session_id: this.session_id });
  }
  private async configure(input: Omit<AgentSessionConfigurationUpdate, "operation_id" | "session_id">): Promise<void> {
    await this.initialize(); await this.options.lease.write(this.session_id, { command: "configure", input: {
      ...input, operation_id: random_uuid(), session_id: this.session_id,
    } });
  }
}
