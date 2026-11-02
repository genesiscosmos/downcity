/**
 * Memory 范围锁的统一薄包装，供 Profile 与 JobStore 复用 File Adapter 的锁实现。
 * SQLite OS 文件锁、进程退出释放及三十秒异步 BUSY 退避均由 Adapter 管理。
 */
import { FileMemoryStorageAdapter } from "../adapters/FileMemoryStorageAdapter.js";

/**
 * 锁定实际存储根目录中的一个独立范围；同一 root + scope_key 使用同一把锁。
 * 调用方不可在持锁回调中重入同一范围，不同根目录默认互相独立。
 */
export async function with_memory_scope_lock<T>(
  root_path: string,
  operation: () => Promise<T>,
  scope_key = "memory-state",
): Promise<T> {
  const storage = new FileMemoryStorageAdapter({ root_path });
  return await storage.with_scope_lock(scope_key, operation);
}
