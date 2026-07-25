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

  /**
   * Workspace 的显式环境变量覆盖项。
   *
   * 关键点（中文）
   * - 显式值覆盖 Workspace 根目录 `.env` 中的同名字段。
   * - 最终环境变量由 Workspace 持有，不会写回 `process.env` 或 `.env`。
   */
  env?: Record<string, string | undefined>;
}
