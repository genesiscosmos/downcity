/**
 * Builtin Memory Provider 使用的低层存储 Adapter 协议。
 *
 * 关键点（中文）
 * - Adapter 只处理 Provider 内部的逻辑 key 与文本，不表达 Memory 领域语义。
 * - 文件、SQLite、对象存储或远程 KV 都可以实现该协议。
 * - MemoryPlugin 和 Agent SDK 不得直接依赖本接口。
 */

/** 存储 Adapter 返回的文本条目。 */
export interface MemoryStorageEntry {
  /** Provider 内部使用的稳定逻辑 key。 */
  key: string;

  /** 当前条目的完整 UTF-8 文本。 */
  content: string;
}

/** Builtin Memory Provider 的最小文本存储能力。 */
export interface MemoryStorageAdapter {
  /** 当前存储实现的稳定名称。 */
  readonly name: string;

  /** 初始化存储根与必要结构。 */
  initialize(): Promise<void>;

  /** 判断指定逻辑 key 是否存在。 */
  has(key: string): Promise<boolean>;

  /** 读取指定逻辑 key；不存在时返回空。 */
  read(key: string): Promise<string | null>;

  /** 原子创建或替换指定逻辑 key 的完整内容。 */
  write(key: string, content: string): Promise<void>;

  /** 列出指定逻辑前缀下的全部文本条目。 */
  list(prefix: string): Promise<MemoryStorageEntry[]>;

  /** 删除指定逻辑 key；不存在时保持幂等。 */
  delete(key: string): Promise<void>;

  /** 释放 Adapter 持有的资源。 */
  dispose(): Promise<void>;
}
