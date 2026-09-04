/** 本地文件系统配置类型。 */

/** LocalFileSystem 构造参数。 */
export interface LocalFileSystemOptions {
  /** 当前文件系统允许访问的绝对根路径。 */
  root_path: string;

  /** 新建目录使用的权限；省略时遵循进程默认权限。 */
  directory_mode?: number;

  /** 新建文件使用的权限；省略时遵循进程默认权限。 */
  file_mode?: number;
}
