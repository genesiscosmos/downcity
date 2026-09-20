/**
 * Workspace 工具集合类型。
 *
 * 关键点（中文）
 * - 只包含对当前 Workspace 文件、搜索和可选 Shell 的操作。
 * - Power Tool 与调用方自定义 Tool 不属于本类型，由 Agent 统一注册。
 */

import type { AgentTool } from "@downcity/type";
import type { FileSystem } from "./FileSystem.js";
import type { WorkspaceShell } from "../shell/WorkspaceShell.js";

/** 当前 Workspace 向 Agent 提供的模型工具集合。 */
export type WorkspaceTools = Record<string, AgentTool>;

/** Workspace Tools 构造参数。 */
export interface CreateWorkspaceToolsOptions {
  /** 当前 Workspace 唯一的 rooted 文件能力。 */
  files: FileSystem;

  /** 当前 Workspace 可选的命令与进程能力。 */
  shell?: WorkspaceShell;
}
