/** 本地文件系统配置类型。 */

import type { WorkspaceSandboxMount } from "@downcity/type/shell";

/** LocalFileSystem 构造参数。 */
export interface LocalFileSystemOptions {
  /** 当前文件系统允许访问的绝对根路径。 */
  root_path: string;

  /** 新建目录使用的权限；省略时遵循进程默认权限。 */
  directory_mode?: number;

  /** 新建文件使用的权限；省略时遵循进程默认权限。 */
  file_mode?: number;

  /**
   * 读取当前隔离环境已成立挂载的惰性提供者。
   *
   * 关键点（中文）
   * - 使用惰性函数而不是快照：文件系统可能在 Shell 绑定之前构造，挂载要到绑定时才成立。
   * - 未提供时，沙箱内绝对路径不会被翻译，与没有隔离环境的行为一致。
   */
  read_sandbox_mounts?: () => readonly WorkspaceSandboxMount[];
}
