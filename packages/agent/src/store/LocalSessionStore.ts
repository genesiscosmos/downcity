/**
 * LocalSessionStore：单个本地 Session 的 JSONL 持久化视图。
 *
 * 职责说明（中文）
 * - 集中创建 Message Store，并封装 Metadata 与 Instruction 的物理路径。
 * - Session 领域只持有本对象，不再自行拼接任何存储路径。
 */

import { JsonlSessionMessageStore } from "@/session/messages/JsonlSessionMessageStore.js";
import {
  getSdkAgentSessionInstructionPath,
  getSdkAgentSessionMetaPath,
  getSdkAgentSessionAssistantMessagePath,
  getSdkAgentSessionMessagesPath,
} from "@/session/storage/Paths.js";
import { normalize_session_metadata } from "@/session/storage/Metadata.js";
import type { SessionHistoryMetaV1 } from "@/executor/types/SessionHistoryMeta.js";
import type { SessionStore } from "@/types/store/SessionStore.js";
import type { FileSystem } from "@/types/workspace/FileSystem.js";
import type { LocalSessionStoreOptions } from "@/types/store/LocalStore.js";

/** 本地 Session Store。 */
export class LocalSessionStore implements SessionStore {
  /** 当前 Session 的稳定标识。 */
  readonly session_id: string;

  /** 当前 Session 的 JSONL Message Store。 */
  readonly messages: JsonlSessionMessageStore;

  /** 当前 Store 与 AgentTools 共用的 Workspace 文件能力。 */
  private readonly files: FileSystem;

  /** 当前 Agent 的稳定标识。 */
  private readonly agent_id: string;

  constructor(options: LocalSessionStoreOptions) {
    this.files = options.files;
    this.agent_id = options.agent_id;
    this.session_id = options.session_id;
    this.messages = new JsonlSessionMessageStore({
      session_id: this.session_id,
      file_path: getSdkAgentSessionMessagesPath(
        this.files.root_path,
        this.agent_id,
        this.session_id,
      ),
      assistant_message_file_path: getSdkAgentSessionAssistantMessagePath(
        this.files.root_path,
        this.agent_id,
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
      return normalize_session_metadata(raw, this.session_id, this.agent_id);
    } catch {
      return normalize_session_metadata({}, this.session_id, this.agent_id);
    }
  }

  /** 写入完整 Session Metadata。 */
  async write_metadata(metadata: SessionHistoryMetaV1): Promise<void> {
    await this.files.write_file_atomically(
      this.metadata_path(),
      `${JSON.stringify(metadata, null, 2)}\n`,
    );
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
    const instruction_path = getSdkAgentSessionInstructionPath(
      this.files.root_path,
      this.agent_id,
      this.session_id,
    );
    await this.files.write_file_atomically(instruction_path, instruction);
  }

  /** 返回当前 Session instruction.md 的 Workspace 路径。 */
  private instruction_path(): string {
    return getSdkAgentSessionInstructionPath(
      this.files.root_path,
      this.agent_id,
      this.session_id,
    );
  }

  /** 返回当前 Session meta.json 的 Workspace 路径。 */
  private metadata_path(): string {
    return getSdkAgentSessionMetaPath(
      this.files.root_path,
      this.agent_id,
      this.session_id,
    );
  }
}
