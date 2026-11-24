/** 一个 Session 持有一个 Worker/QuickJS 实例；宿主预算可强制终止阻塞中的解释器。 */
import { Worker } from "node:worker_threads";
import type { EngineInput, EngineResult } from "../types/Runtime.js";

/** Worker 消息传输；不向 guest 传递函数、文件句柄或 City 引用。 */
export class WorkerEngine {
  private readonly worker = new Worker(new URL("./RuntimeWorker.js", import.meta.url), { resourceLimits: { maxOldGenerationSizeMb: 192, maxYoungGenerationSizeMb: 32, stackSizeMb: 4 } });
  private readonly ready: Promise<void>;
  private failure?: Error;
  private reject_ready?: (error: Error) => void;
  private finish?: (result: EngineResult) => void;
  private reject?: (error: Error) => void;
  private on_call?: (symbol: string, input: unknown) => Promise<unknown>;
  private execution_id = "";
  private stopped = false;

  constructor() {
    this.ready = new Promise((resolve, reject) => {
      this.reject_ready = reject;
      this.worker.on("error", error => { const failure = error instanceof Error ? error : new Error(String(error)); this.failure = failure; reject(failure); this.reject?.(failure); });
      this.worker.on("exit", code => {
        if (!this.stopped) { const error = new Error(`engine_failed: worker exited (${code})`); this.failure = error; reject(error); this.reject?.(error); }
      });
      this.worker.on("message", message => {
        if (message.type === "ready") { resolve(); return; }
        if (message.execution_id !== this.execution_id || this.stopped) return;
        if (message.type === "result") { this.finish?.(message.result); this.finish = undefined; this.on_call = undefined; }
        if (message.type === "call") {
          const callback = this.on_call;
          if (!callback) return;
          void callback(message.symbol, message.input).then(value => {
            const text = JSON.stringify(value ?? null);
            if (Buffer.byteLength(text) > 1024 * 1024) throw new Error("serialization_error: bridge frame exceeds 1 MiB");
            this.worker.postMessage({ type: "reply", call_id: message.call_id, value });
          }).catch(error => {
            if (!this.stopped) this.worker.postMessage({ type: "reply", call_id: message.call_id, error: String(error).slice(0, 4096) });
          });
        }
      });
    });
    // 懒启动失败在 execute 观察；避免无人等待 ready 时出现未处理 rejection。
    void this.ready.catch(() => undefined);
  }

  async execute(input: EngineInput, on_call: (symbol: string, input: unknown) => Promise<unknown>): Promise<EngineResult> {
    await this.ready;
    if (this.stopped || this.failure) throw this.failure ?? new Error("engine_closed");
    this.execution_id = input.execution_id;
    this.on_call = on_call;
    return await new Promise((resolve, reject) => {
      this.finish = resolve; this.reject = reject;
      this.worker.postMessage({ type: "execute", input });
    });
  }

  async dispose(): Promise<void> {
    if (this.stopped) return;
    this.stopped = true;
    this.reject_ready?.(new Error("execution_cancelled: engine disposed before readiness"));
    this.reject?.(new Error("execution_cancelled: engine disposed"));
    this.on_call = undefined;
    await this.worker.terminate();
  }
}
