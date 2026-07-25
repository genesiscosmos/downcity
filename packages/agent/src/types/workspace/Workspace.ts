/**
 * Workspace 公共类型。
 *
 * 关键点（中文）
 * - Workspace 是统一资源容器，同时提供 Store、Tool 与可选 Shell。
 * - 所有平台共用同一类型，平台差异由可选 Shell 的 Sandbox Adapter 处理。
 */

import type { Shell } from "@downcity/shell";

/** Workspace 构造参数。 */
export interface WorkspaceOptions {
  /** Workspace 绑定的本地项目目录；构造时会解析为真实绝对路径。 */
  path: string;

  /** Workspace 内可选的受控命令执行能力。 */
  shell?: Shell;
}
