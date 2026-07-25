/**
 * 本地 Workspace Store 实现的构造类型。
 *
 * 关键点（中文）
 * - 本地 Store 只接收 Workspace 已创建的 FileSystem，不单独接收存储根目录。
 * - AgentStore 与 SessionStore 因而始终和 AgentTools 使用同一资源容器。
 */

import type { FileSystem } from "@/types/workspace/FileSystem.js";

/** LocalAgentStore 构造参数。 */
export interface LocalAgentStoreOptions {
  /** 当前 Store 与 AgentTools 共用的 Workspace 文件能力。 */
  files: FileSystem;
  /** 当前 Agent 的稳定标识，用于划分 `.downcity/agents` 子目录。 */
  agent_id: string;
}

/** LocalSessionStore 构造参数。 */
export interface LocalSessionStoreOptions {
  /** 当前 Store 与 AgentTools 共用的 Workspace 文件能力。 */
  files: FileSystem;
  /** 当前 Session 所属 Agent 的稳定标识。 */
  agent_id: string;
  /** 当前 Session 的稳定标识。 */
  session_id: string;
}

/** JsonlSessionMessageStore 构造参数。 */
export interface JsonlSessionMessageStoreOptions {
  /** 当前 Session 的稳定标识。 */
  session_id: string;
  /** Active JSONL 文件的绝对路径。 */
  file_path: string;
  /** Assistant 运行中快照的可选绝对路径。 */
  assistant_message_file_path?: string;
}
