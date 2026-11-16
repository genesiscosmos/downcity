/**
 * 项目运行占用门禁。先关闭新请求再检查占用，同步状态变更间没有 await 窗口。
 * 句柄只能借用，完整流结束才释放；清理失败时门禁持续关闭。
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { ExtensionFailure } from "./ExtensionError.js";

/** 所有能力入口共享同一门禁。 */
export class ExtensionGate {
  private closed: boolean;
  private readonly owner_scope = new AsyncLocalStorage<{ /** 生命周期返回后关闭，禁止派生后台计时器继承豁免。 */ active: boolean }>();

  /** owner 清理调用链可访问自有资源，其他并发请求仍遵守关闭门禁。 */
  async lifecycle<T>(operation: () => T | Promise<T>): Promise<T> {
    const scope = { active: true };
    try { return await this.owner_scope.run(scope, operation); }
    finally { scope.active = false; }
  }

  constructor(initially_closed = false) { this.closed = initially_closed; }
  private readonly consumers = new Map<symbol, string>();

  /** 借用执行资源，调用方必须在完整工作结束时释放。 */
  acquire(consumer: string, allow_owner = true): () => void {
    if (allow_owner && this.owner_scope.getStore()?.active) return () => {};
    if (this.closed) throw new ExtensionFailure("project_unavailable", "Extension is being replaced or is unavailable", "load", 4);
    const lease = Symbol(consumer);
    this.consumers.set(lease, consumer);
    return () => { this.consumers.delete(lease); };
  }

  /** 关闭入口并检查占用；busy 原子恢复入口，保留当前运行。 */
  close(): void {
    // 已关闭且无新请求的失败清理允许显式重试；项目操作互斥由 Manager 持有。
    if (this.closed) return;
    this.closed = true;
    if (this.consumers.size) {
      this.closed = false;
      throw new ExtensionFailure("project_busy", "Extension is in use; stop its work through the existing controls and retry", "dispose", 4, { consumers: [...new Set(this.consumers.values())] });
    }
  }

  /** 只有完整初始化并发布目录后打开。 */
  open(): void { this.closed = false; }
}

/** 将租约绑定到实际输出流，不在 stream() 返回时提前释放。 */
export function track_extension_stream<T>(source: ReadableStream<T>, release: () => void, signal?: AbortSignal): ReadableStream<T> {
  const reader = source.getReader();
  let finished = false;
  const finish = () => { if (!finished) { finished = true; signal?.removeEventListener("abort", abort); release(); } };
  const abort = () => { void reader.cancel(signal?.reason).catch(() => undefined).finally(finish); };
  if (signal?.aborted) abort();
  else signal?.addEventListener("abort", abort, { once: true });
  return new ReadableStream<T>({
    async pull(controller) {
      try {
        const result = await reader.read();
        if (result.done) { finish(); controller.close(); }
        else controller.enqueue(result.value);
      } catch (error) { finish(); controller.error(error); }
    },
    async cancel(reason) { try { await reader.cancel(reason); } finally { finish(); } },
  }, { highWaterMark: 0 });
}
