/**
 * 进程共享的 Agent Session 存储运行时和独立读/写租约。
 *
 * 连接和 Worker 生命周期属于存储，不属于执行 Agent。最后一个租约等待已接受工作
 * 结算后关闭目标连接；所有目标释放后排空共享调度器并关闭线程。再次获取必须等待
 * 上一代关闭，避免同路径在两个运行时中同时出现写连接。
 */
import path from "node:path";
import type { AgentSessionWorkerDiagnostic } from "@/types/store/AgentSessionDiagnostic.js";
import type {
  AgentSessionRuntimeLease, AgentSessionRuntimeOwner, AgentSessionRuntimeTarget,
  AgentSessionRuntimeWriteOptions,
} from "@/types/store/AgentSessionRuntime.js";
import type { AgentSessionReadCommand, AgentSessionWorkerRequest, AgentSessionWriteCommand } from "@/types/store/AgentSessionWorker.js";
import { AgentSessionFileLease } from "./AgentSessionFileLease.js";
import { AgentSessionDatabase } from "./AgentSessionDatabase.js";
import { AgentSessionWorkerPool } from "./AgentSessionWorkerPool.js";
import { AgentStorageScheduler } from "./AgentStorageScheduler.js";
import { wait_agent_storage_drain } from "./AgentStorageDrain.js";
import { reconcile_agent_session_operation } from "./AgentSessionOperation.js";
import { execute_agent_session_command } from "./AgentSessionCommands.js";
import { AgentSessionStorageError, agent_session_failure } from "./AgentSessionErrors.js";

/** 真实请求的 UTF-8 字节由写调度器和独立读池分别计费。 */
function request_payload(target: AgentSessionRuntimeTarget, readonly: boolean, operation: AgentSessionReadCommand | AgentSessionWriteCommand, release_owner = false): string {
  const request: AgentSessionWorkerRequest = {
    request_id: 0, agent_id: target.agent_id, database_path: target.database_path,
    readonly, allow_create: !readonly && target.allow_create, operation, release_owner,
  };
  return JSON.stringify(request);
}

/** 单一进程内资源拥有者，所有 SessionStore 和 Browser 通过 lease 共享。 */
class AgentSessionRuntime {
  readonly owners = new Map<string, AgentSessionRuntimeOwner>();
  readonly writers = new AgentSessionWorkerPool(false, (target, diagnostic) => this.report_diagnostic(target, diagnostic));
  readonly readers = new AgentSessionWorkerPool(true, (target, diagnostic) => this.report_diagnostic(target, diagnostic));
  private read_sequence = 0;
  readonly read_scheduler = new AgentStorageScheduler({
    budgets: { concurrency: 2, global_requests: 128, global_bytes: 32 * 1024 * 1024 },
    execute: async (_scope, payload) => await this.readers.execute(payload),
  });
  readonly scheduler = new AgentStorageScheduler({
    execute: async (owner_key, payload) => {
      const owner = this.owners.get(owner_key);
      if (!owner) throw new Error("session_storage_owner_released");
      if (owner.target.database_path !== ":memory:") {
        owner.writer_opened = true;
        return await this.writers.execute(payload);
      }
      if (!owner.memory) {
        const request = JSON.parse(payload) as AgentSessionWorkerRequest;
        if (request.readonly || !owner.target.allow_create) throw new Error("session_storage_not_found");
        owner.memory = new AgentSessionDatabase(owner.target);
      }
      try {
        const request = JSON.parse(payload) as AgentSessionWorkerRequest;
        return JSON.stringify(execute_agent_session_command(owner.memory, request.operation));
      } catch (error) {
        const request = JSON.parse(payload) as AgentSessionWorkerRequest;
        throw new AgentSessionStorageError(request.operation.command, agent_session_failure(error));
      }
    },
  });

  /** 只向目标存储的有效租约发布，不把共享线程绑定到执行 Agent。 */
  private report_diagnostic(target: string, diagnostic: AgentSessionWorkerDiagnostic): void {
    const sinks = this.owners.get(target)?.diagnostic_sinks;
    if (!sinks?.size) {
      try { console.info("[session.storage.worker]", JSON.stringify(diagnostic)); } catch { /* 尽力诊断。 */ }
      return;
    }
    for (const sink of sinks.keys()) {
      try { sink(diagnostic); } catch { /* 诊断失败不能改变存储语义。 */ }
    }
  }

  /** 每个只读任务独立调度，限制同时派发数但允许同 Agent 两个短读并发。 */
  async read(payload: string, signal?: AbortSignal): Promise<string> {
    return await this.read_scheduler.submit({ agent_id: `reader:${++this.read_sequence}`, session_id: "read", payload, signal });
  }

  /** 只有无任何存储引用时才能销毁共享池。 */
  async dispose(): Promise<void> {
    await Promise.all([this.scheduler.dispose(), this.read_scheduler.dispose()]);
    const results = await Promise.allSettled([this.writers.dispose(), this.readers.dispose()]);
    const errors = results.filter((result): result is PromiseRejectedResult => result.status === "rejected").map(result => result.reason);
    if (errors.length) throw new AggregateError(errors, "session_storage_dispose_failed");
  }
}

let shared: AgentSessionRuntime | undefined;
let shared_closing: Promise<void> | undefined;

/** 获得独立租约；创建、模型与 Workspace 执行不属于此能力。 */
export async function acquire_agent_session_storage(target_input: AgentSessionRuntimeTarget, readonly: boolean): Promise<AgentSessionRuntimeLease> {
  if (shared_closing) await shared_closing;
  const target = { ...target_input, on_diagnostic: undefined,
    database_path: target_input.database_path === ":memory:" ? ":memory:" : path.resolve(target_input.database_path) };
  if (!target.agent_id.trim() || (target.database_path === ":memory:" && !target.memory_scope)) throw new Error("session_storage_address_invalid");
  const owner_key = target.database_path === ":memory:" ? `memory:${target.memory_scope}` : target.database_path;
  const runtime = shared ??= new AgentSessionRuntime();
  let owner = runtime.owners.get(owner_key);
  if (owner?.closing) { await owner.closing; return await acquire_agent_session_storage({ ...target, on_diagnostic: target_input.on_diagnostic }, readonly); }
  if (owner && owner.target.agent_id !== target.agent_id) throw new Error("session_storage_identity_conflict");
  if (!owner) { owner = { target, references: 0, diagnostic_sinks: new Map() }; runtime.owners.set(owner_key, owner); }
  if (!readonly && target.allow_create) owner.target.allow_create = true;
  owner.references += 1;
  const retained = owner;
  const sink = target_input.on_diagnostic;
  if (sink) retained.diagnostic_sinks.set(sink, (retained.diagnostic_sinks.get(sink) ?? 0) + 1);
  const pending = new Set<Promise<unknown>>();
  let released = false;
  let release_promise: Promise<void> | undefined;
  // Reader Worker按请求关闭DB；文件访问租约必须覆盖Browser/导出的整个生命周期。
  let file_lease: AgentSessionFileLease | undefined;
  const retain_files = (required = false) => {
    if (file_lease || retained.target.database_path === ":memory:") return;
    try { file_lease = AgentSessionFileLease.acquire(retained.target.database_path, retained.target.agent_id); }
    catch (error) {
      if (!required && ((error as NodeJS.ErrnoException).code === "ENOENT" || (error as Error).message === "session_attachment_coordination_required")) return;
      throw error;
    }
  };

  /** 操作在租约关闭前登记，避免最后释放遗漏同一 tick 接受的写入。 */
  const track = <T>(operation: () => Promise<T>): Promise<T> => {
    if (released) return Promise.reject(new Error("session_storage_lease_released"));
    let result: Promise<T>;
    try { result = operation(); } catch (error) { return Promise.reject(error); }
    pending.add(result);
    void result.then(() => pending.delete(result), () => pending.delete(result));
    return result;
  };

  return {
    read: <T>(operation: AgentSessionReadCommand, signal?: AbortSignal) => track(async () => {
      if (signal?.aborted) throw new Error("session_storage_cancelled");
      retain_files();
      const payload = request_payload(retained.target, true, operation);
      const result = retained.target.database_path === ":memory:"
        ? await runtime.scheduler.submit({ agent_id: owner_key, session_id: "collection", payload, signal })
        : await runtime.read(payload, signal);
      retain_files(true);
      // 文件读一旦派发完成后才取消 UI 提交，不把读取消误传为写事务回滚。
      if (signal?.aborted) throw new Error("session_storage_cancelled");
      return JSON.parse(result) as T;
    }),
    write: <T>(session_id: string, operation: AgentSessionWriteCommand, options?: AgentSessionRuntimeWriteOptions) => track(async () => {
      if (readonly) throw new Error("session_storage_readonly");
      // 在 JSON 序列化丢弃 undefined 字段之前拒绝非法归属配置。
      if (operation.command === "configure" && ("workspace_id" in operation.input || "workspace" in operation.input)) {
        throw new Error("session_workspace_immutable");
      }
      retain_files();
      try {
        const result = await runtime.scheduler.submit({
          agent_id: owner_key, session_id, payload: request_payload(retained.target, false, operation),
          signal: options?.signal, assert_dispatchable: options?.assert_dispatchable,
        });
        retain_files(true);
        return JSON.parse(result) as T;
      } catch (error) {
        if (!(error instanceof Error) || error.message !== "session_storage_outcome_unknown") throw error;
        const reconciled = await reconcile_agent_session_operation<T>(operation,
          async () => await runtime.writers.settle_failed_workers(),
          async (operation_id) => JSON.parse(await runtime.read(request_payload(retained.target, true, { command: "receipt", operation_id }))),
          error,
        );
        retain_files(true);
        return reconciled;
      }
    }),
    release: () => {
      if (release_promise) return release_promise;
      released = true;
      release_promise = wait_agent_storage_drain((async () => {
        const results = await Promise.allSettled([...pending]);
        const errors = results.filter((result): result is PromiseRejectedResult => result.status === "rejected").map(result => result.reason);
        file_lease?.release();
        file_lease = undefined;
        retained.references -= 1;
        if (!retained.references) {
          retained.closing = (async () => {
            if (retained.memory) retained.memory.close();
            else if (retained.writer_opened) {
              await runtime.writers.execute(request_payload(retained.target, false, { command: "receipt", operation_id: "release" }, true));
            }
            // 最后拥有者保留诊断路由直到共享池退出，关闭事件仍写入原租约日志。
            if (runtime.owners.size === 1 && shared === runtime) {
              shared = undefined;
              const closing = runtime.dispose(); shared_closing = closing;
              try { await closing; }
              finally {
                if (shared_closing === closing) shared_closing = undefined;
                runtime.owners.delete(owner_key);
              }
            } else runtime.owners.delete(owner_key);
          })();
          try { await retained.closing; } catch (error) { errors.push(error); }
        }
        if (errors.length) throw new AggregateError(errors, "session_storage_release_failed");
      })()).finally(() => {
        if (!sink) return;
        const references = (retained.diagnostic_sinks.get(sink) ?? 1) - 1;
        if (references) retained.diagnostic_sinks.set(sink, references);
        else retained.diagnostic_sinks.delete(sink);
      });
      return release_promise;
    },
  };
}
