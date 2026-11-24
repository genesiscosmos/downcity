/** ContextPower 执行编排：活动预算、逐次 host 身份、调用回执与有界结果；不包含业务分发。 */
import { runtime_error } from "./RuntimeError.js";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { PowerContext } from "../../../../power/index.js";
import { ApplicationCatalog } from "../../../../application/ApplicationCatalog.js";
import type { ApplicationModule, ApplicationPolicy } from "../../../../application/types/Application.js";
import { SessionRuntimePool, runtime_key } from "./SessionRuntimePool.js";
import type { ReceiptQuery, ResultQuery } from "./types/RuntimeQueries.js";
import type { ExecuteInput, ExecuteResult, CallReceipt } from "./types/Runtime.js";

/** 唯一运行服务由 ContextPower 持有；宿主端口只在组合根注入。 */
export class RuntimeService {
  private readonly pool = new SessionRuntimePool();
  private readonly catalog: ApplicationCatalog;
  private readonly receipts = new Map<string, { key: string; value: CallReceipt; at: number }>();
  private readonly results = new Map<string, { key: string; text: string; at: number }>();
  private closed = false;
  /** 宿主已接收的调用独立于 Worker 终止结算；释放数据库前必须等待。 */
  private readonly in_flight = new Set<Promise<unknown>>();

  constructor(modules: readonly ApplicationModule[], policy?: ApplicationPolicy) {
    const caller_key = (context: PowerContext): string => {
      if (!context.session) throw new Error("host_unavailable: Session required");
      return runtime_key(context.agent.id, context.session.id, context.session.type);
    };
    this.catalog = new ApplicationCatalog([...modules, { namespace: "runtime", exports: [
      { symbol: "runtime.receipts", description: "Query this Session's short-lived SDK call receipts, including calls whose effects completed after a cell timed out. Never replay a whole script to recover an unknown outcome.",
        input: z.object({ execution_id: z.string(), cursor: z.number().int().min(0).default(0) }).strict(),
        output: z.object({ calls: z.array(z.object({ receipt_id: z.string(), execution_id: z.string(), symbol: z.string(), status: z.string(), error: z.string().optional() })), next_cursor: z.number().nullable() }),
        effect: "read", authorize: (_input, call) => { caller_key(call.context); }, invoke: (input, call) => {
          const query = input as ReceiptQuery;
          const calls = [...this.receipts.values()].filter(item => item.key === caller_key(call.context) && item.value.execution_id === query.execution_id).map(item => item.value);
          return { calls: calls.slice(query.cursor, query.cursor + 20), next_cursor: query.cursor + 20 < calls.length ? query.cursor + 20 : null };
        } },
      { symbol: "runtime.read_result", description: "Read a bounded UTF-16 text page of a truncated non-secret result. References are scoped to the calling Session and expire after ten minutes.",
        input: z.object({ result_ref: z.string(), offset: z.number().int().min(0).default(0) }).strict(), output: z.object({ text: z.string(), next_offset: z.number().nullable() }),
        effect: "read", authorize: (_input, call) => { caller_key(call.context); }, invoke: (input, call) => {
          const query = input as ResultQuery;
          const item = this.results.get(query.result_ref);
          if (!item || item.key !== caller_key(call.context) || Date.now() - item.at > 600_000) throw new Error("permission_denied: result is unavailable in this Session");
          const end = Math.min(item.text.length, query.offset + 4096);
          return { text: item.text.slice(query.offset, end), next_offset: end < item.text.length ? end : null };
        } },
    ] }], policy);
  }

  /** 已取消请求在出队后、引擎创建前拒绝；代码不能指定 Session key。 */
  async execute(input: ExecuteInput, context: PowerContext): Promise<ExecuteResult> {
    if (this.closed || !context.session) throw new Error("host_unavailable: trusted live Session required");
    context.abort_signal?.throwIfAborted();
    const key = runtime_key(context.agent.id, context.session.id, context.session.type);
    return await this.pool.schedule(key, async (entry, pool_signal) => {
      const execution_id = randomUUID();
      const controller = new AbortController();
      const calls: CallReceipt[] = [];
      let gate_open = true;
      let timed_out = false;
      let paused = 0;
      let remaining = input.timeout_ms;
      let started = Date.now();
      let timer: ReturnType<typeof setTimeout> | undefined;
      const arm = (): void => { started = Date.now(); timer = setTimeout(() => { timed_out = true; controller.abort(new Error("execution_timeout")); }, Math.max(1, remaining)); };
      const pause_budget = (): (() => void) => {
        if (paused++ === 0) { clearTimeout(timer); remaining -= Date.now() - started; }
        let resumed = false;
        return () => { if (resumed) return; resumed = true; if (--paused === 0 && gate_open && !controller.signal.aborted) arm(); };
      };
      const abort = (): void => { gate_open = false; void entry.engine.dispose(); };
      const relay = (): void => controller.abort(new Error("execution_cancelled"));
      controller.signal.addEventListener("abort", abort, { once: true });
      const sources = [context.abort_signal, pool_signal].filter((signal): signal is AbortSignal => Boolean(signal));
      for (const signal of sources) { signal.addEventListener("abort", relay, { once: true }); if (signal.aborted) relay(); }
      arm();
      let result: ExecuteResult;
      try {
        controller.signal.throwIfAborted();
        const output = await entry.engine.execute({ ...input, execution_id, declarations: this.catalog.declarations, descriptors: this.catalog.descriptors }, async (symbol, raw_input) => {
          if (!gate_open || controller.signal.aborted) throw new Error("execution_cancelled: execution call gate is closed");
          if (calls.length >= 256) throw new Error("runtime_busy: per-cell call budget exhausted");
          const receipt: CallReceipt = { receipt_id: randomUUID(), execution_id, symbol, status: "pending" };
          calls.push(receipt);
          this.receipts.set(receipt.receipt_id, { key, value: receipt, at: Date.now() });
          const operation = this.catalog.invoke(symbol, raw_input, { context, execution_id, signal: controller.signal, pause_budget });
          this.in_flight.add(operation);
          try {
            const value = await operation;
            receipt.status = "completed";
            // 投影和秘密裁剪发生在跨引擎边界之前，明文从不交给脚本。
            return context.call.interactions.redact_secret_values(value);
          } catch (error) {
            const text = String(context.call.interactions.redact_secret_values(String(error))).slice(0, 4096);
            receipt.status = /permission_denied|approval_denied/u.test(text) ? "denied" : "failed"; receipt.error = text;
            throw new Error(text);
          } finally { this.in_flight.delete(operation); }
        });
        const unknown_calls = calls.some(call => call.status === "pending");
        const cpu_timed_out = output.error?.startsWith("execution_timeout") === true;
        result = { execution_id, runtime_generation: entry.generation, status: cpu_timed_out ? "timed_out" : output.error ? "failed" : "completed", value: output.value, logs: output.logs, calls, error: output.error ? runtime_error(output.error) : null, state_reset: entry.generation > 1 || unknown_calls || cpu_timed_out };
        if (unknown_calls || cpu_timed_out) await this.pool.reset(key);
      } catch (error) {
        result = { execution_id, runtime_generation: entry.generation, status: timed_out ? "timed_out" : controller.signal.aborted ? "cancelled" : "failed", value: null, logs: [], calls, error: runtime_error(timed_out ? "execution_timeout" : String(error)), state_reset: true };
        await this.pool.reset(key);
      } finally {
        gate_open = false;
        clearTimeout(timer);
        controller.signal.removeEventListener("abort", abort);
        // 关闭 SDK signal 但保留正常完成的引擎；未 await 的审批不能在 cell 终态后提交效果。
        if (!controller.signal.aborted) controller.abort(new Error("execution_cancelled: cell reached terminal state"));
        for (const signal of sources) signal.removeEventListener("abort", relay);
        for (const call of calls) if (call.status === "pending") call.status = "outcome_unknown";
      }
      const safe = context.call.interactions.redact_secret_values(result) as ExecuteResult;
      void context.logger.info("Context execution completed", { execution_id, status: safe.status, call_count: calls.length });
      return this.bound_output(safe, input.max_output_tokens * 4, key);
    });
  }

  /** 大结果存入隔离短期存储；摘要预算由值、日志和调用 trace 共同使用。 */
  private bound_output(result: ExecuteResult, budget: number, key: string): ExecuteResult {
    const text = JSON.stringify(result);
    this.prune();
    if (Buffer.byteLength(text) <= budget) return result;
    const result_ref = `context-result:${randomUUID()}`;
    this.results.set(result_ref, { key, text, at: Date.now() });
    const bounded = { ...result, value: null, logs: [] as string[], calls: result.calls.map(call => ({ ...call })), error: result.error ? { ...result.error, message: result.error.message.slice(0, 200) } : null, result_ref };
    while (bounded.calls.length && Buffer.byteLength(JSON.stringify(bounded)) > budget) bounded.calls.pop();
    return bounded;
  }

  private prune(): void {
    for (const [id, item] of this.results) if (Date.now() - item.at > 600_000) this.results.delete(id);
    while (this.results.size >= 32) this.results.delete(this.results.keys().next().value!);
    for (const [id, item] of this.receipts) if (Date.now() - item.at > 600_000 && item.value.status !== "pending") this.receipts.delete(id);
    while (this.receipts.size > 4096) this.receipts.delete(this.receipts.keys().next().value!);
  }

  async release_session(agent_id: string, session_id: string, type: string): Promise<void> {
    const key = runtime_key(agent_id, session_id, type);
    await this.pool.release(key);
    for (const [id, item] of this.results) if (item.key === key) this.results.delete(id);
    for (const [id, item] of this.receipts) if (item.key === key) this.receipts.delete(id);
  }

  async dispose(): Promise<void> {
    this.closed = true;
    await this.pool.dispose();
    await Promise.allSettled([...this.in_flight]);
    this.results.clear(); this.receipts.clear();
  }
}
