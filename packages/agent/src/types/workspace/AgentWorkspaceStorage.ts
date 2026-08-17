/**
 * AgentWorkspace 持久化存储类型。
 *
 * 该类型把项目文件能力与 Downcity 内部数据能力明确分离，避免内部状态重新写入
 * Workspace 项目目录。
 */

import type { SessionStore } from "@/types/store/SessionStore.js";
import type { FileSystem } from "@downcity/workspace";

/** Agent 在一个 Workspace 中独享的持久化资源。 */
export interface AgentWorkspaceStorage {
  /** 当前 AgentWorkspace 内部数据的稳定绝对根路径。 */
  root_path: string;

  /** 只允许访问当前内部数据根的文件能力。 */
  files: FileSystem;

  /** 当前 AgentWorkspace 的 Session 集合存储。 */
  sessions: SessionStore;
}
