/** Workspace 私有存储后端协议。 */

import type { FileSystem } from "./FileSystem.js";

/** Workspace 私有存储中的一个受控作用域。 */
export interface WorkspaceStorageScope {
  /** 当前作用域稳定且不可越界的逻辑根路径。 */
  readonly root_path: string;

  /** 只允许访问当前作用域的文件能力。 */
  readonly files: FileSystem;
}

/** Workspace 私有数据后端。 */
export interface WorkspaceStorageProvider {
  /** 按稳定路径片段打开一个受控私有存储作用域。 */
  open_scope(segments: readonly string[]): WorkspaceStorageScope;
}
