/**
 * Workspace 公共类型。
 *
 * 关键点（中文）
 * - Workspace 是项目资源与安全作用域，不保存 Agent 的领域状态。
 * - 所有平台共用同一类型，平台差异由可选 Shell 的 Sandbox Adapter 处理。
 */

import type { Tool } from "ai";
import type { Shell } from "@downcity/shell";
import type { FileSystem } from "@/types/workspace/FileSystem.js";

/** Workspace 构造参数。 */
export interface WorkspaceOptions {
  /** Workspace 绑定的本地项目目录；构造时会解析为真实绝对路径。 */
  path: string;

  /** Workspace 内可选的受控命令执行能力。 */
  shell?: Shell;
}

/** Workspace 向 Agent 暴露的稳定资源视图。 */
export interface WorkspaceResources {
  /** 已解析且不可变的项目根目录。 */
  readonly path: string;

  /** Workspace 根目录内统一的受控文件与搜索能力。 */
  readonly files: FileSystem;

  /** Workspace 内可用的文件、搜索与可选命令工具。 */
  readonly tools: Record<string, Tool>;

  /** Workspace 内可选的受控命令执行能力。 */
  readonly shell?: Shell;
}
