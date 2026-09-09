/** City 提供的底层存储协议。 */

import type { FileSystem } from "../workspace/FileSystem.js";

/** 当前 Storage Scope 为内部 SQLite 数据库提供的位置。 */
export type StorageDatabaseLocation =
  | {
      /** 使用 Scope 根目录内的本地数据库文件。 */
      type: "file";
    }
  | {
      /** 使用跟随当前进程生命周期的内存数据库。 */
      type: "memory";
    };

/** City 存储中的一个受控作用域。 */
export interface StorageScope {
  /** 当前作用域稳定且不可越界的逻辑根路径。 */
  readonly root_path: string;

  /** 只允许访问当前作用域的文件能力。 */
  readonly files: FileSystem;

  /** 当前作用域中结构化数据库应使用的明确位置类型。 */
  readonly database_location: StorageDatabaseLocation;
}

/** 不理解业务语义的底层存储后端。 */
export interface StorageProvider {
  /** 按稳定路径片段打开一个受控私有存储作用域。 */
  open_scope(segments: readonly string[]): StorageScope;

  /** 释放底层连接、锁或临时资源；纯内存/文件实现可以为空操作。 */
  dispose?(): Promise<void> | void;
}
