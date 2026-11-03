/**
 * 跨 City 的 Signal/Batch 账本：每个 Agent/Workspace/target 在平台共享根内原子发布。
 * 文件锁保护事件去重、批次归属和预算预留；City 私有 Job 永久绑定原 owner，不抢占另一个实例。
 */
import { createHash } from "node:crypto";
import type { MemoryDreamLedger, MemoryDreamScope } from "../types/MemoryDream.js";
import { FileMemoryStorageAdapter } from "../adapters/FileMemoryStorageAdapter.js";

/** 确定性范围身份；共享目录由可信组合根指定，不从内容推断。 */
export function memory_dream_scope_key(scope: MemoryDreamScope): string {
  return createHash("sha256").update(JSON.stringify([scope.agent_id, scope.workspace_id ?? null, scope.target])).digest("hex");
}

/** 默认状态不启动自动计算，游标与处理完成水位分别维护。 */
function empty_ledger(scope: MemoryDreamScope): MemoryDreamLedger {
  return { scope: { agent_id: scope.agent_id, ...(scope.workspace_id ? { workspace_id: scope.workspace_id } : {}), target: scope.target },
    enabled: false, accepted_cursor: 0, processed_watermark: 0, signals: [], batches: [],
    budget_day: new Date().toISOString().slice(0, 10), budget_used: 0 };
}

export class MemorySignalStore {
  /** 仅承担做梦账本的安全文件存储。 */
  private readonly storage: FileMemoryStorageAdapter;
  constructor(root_path: string) { this.storage = new FileMemoryStorageAdapter({ root_path }); }

  /** 初始化独立命名空间，不迁移现有记忆数据。 */
  async initialize(): Promise<void> { await this.storage.initialize(); }

  /** 没有登记过的范围返回默认关闭状态。 */
  async read(scope: MemoryDreamScope): Promise<MemoryDreamLedger> {
    const value = await this.storage.read(`scopes/${memory_dream_scope_key(scope)}.json`);
    return value ? JSON.parse(value) as MemoryDreamLedger : empty_ledger(scope);
  }

  /** 整个读改写受跨进程范围锁保护；回调抛错则不发布部分状态。 */
  async mutate<T>(scope: MemoryDreamScope, run: (ledger: MemoryDreamLedger) => T | Promise<T>): Promise<T> {
    return await this.storage.with_scope_lock(memory_dream_scope_key(scope), async () => {
      const ledger = await this.read(scope);
      const result = await run(ledger);
      await this.storage.write(`scopes/${memory_dream_scope_key(scope)}.json`, JSON.stringify(ledger));
      return result;
    });
  }

  /** 只枚举明确登记的范围；不发现或扫描私人 Session 历史。 */
  async scopes(): Promise<MemoryDreamScope[]> {
    return (await this.storage.list("scopes")).map((entry) => (JSON.parse(entry.content) as MemoryDreamLedger).scope);
  }

  /** 重新计算连续处理水位，失败和来源错误不会被后方成功越过。 */
  advance_watermark(ledger: MemoryDreamLedger): void {
    while (ledger.signals.find((signal) => signal.sequence === ledger.processed_watermark + 1)?.state === "processed") {
      ledger.processed_watermark += 1;
    }
  }

  /** Adapter 没有长期句柄，外层仍须等待正在运行的唤醒。 */
  async dispose(): Promise<void> { await this.storage.dispose(); }
}
