/**
 * 进程共享的独立 interaction Worker；与浏览队列、快照和游标没有依赖。
 * 最多 64 个已准入操作、64 条物理 RPC；取消不提前归还 RPC 容量。
 * RPC 30 秒超时统一终止故障线程，退出完成前禁止替换；最后 owner 释放时等待退出。
 */
import { Worker } from "node:worker_threads";
import type { AgentInteraction } from "../../types/agent/AgentInteractions.js";
import type {
  SessionInteractionPending, SessionInteractionRequest, SessionInteractionResponse,
} from "../../types/store/SessionInteractionQuery.js";

const admissions = new Set<(error: Error) => void>();
const pending = new Map<number, SessionInteractionPending>();
let worker: Worker | undefined;
let stopping: Promise<void> | undefined;
let idle_timer: ReturnType<typeof setTimeout> | undefined;
let request_sequence = 0;
let owners = 0;

/** Store 注册只持有生命周期，不启动线程；释放幂等并等待最后线程退出。 */
export function register_session_interaction_store(): () => Promise<void> {
  owners += 1;
  let disposal: Promise<void> | undefined;
  return () => {
    if (disposal) return disposal;
    owners -= 1;
    disposal = owners ? Promise.resolve() : stop_worker(new Error("session_interaction_disposed: All Stores disposed"));
    return disposal;
  };
}

/** 进程准入包含排队及已取消但仍在物理执行的操作。 */
export function admit_session_interaction(fail: (error: Error) => void): () => void {
  if (admissions.size >= 64) throw new Error("session_interaction_busy: Process operation capacity is 64");
  admissions.add(fail);
  if (idle_timer) clearTimeout(idle_timer);
  idle_timer = undefined;
  worker?.ref();
  let released = false;
  return () => {
    if (released) return;
    released = true;
    admissions.delete(fail);
    schedule_idle();
  };
}

/** 每批确认才发送下一批；故障没有宿主同步读库回退。 */
export async function request_session_interactions(
  request: Omit<SessionInteractionRequest, "request_id">,
): Promise<AgentInteraction[]> {
  if (stopping) throw new Error("session_interaction_busy: Worker is terminating");
  if (!owners) throw new Error("session_interaction_disposed: No Store owner");
  if (pending.size >= 64) throw new Error("session_interaction_busy: Worker RPC capacity is 64");
  const current = ensure_worker();
  const request_id = ++request_sequence;
  return await new Promise<AgentInteraction[]>((resolve, reject) => {
    const timer = setTimeout(() => {
      void stop_worker(new Error("session_interaction_worker_failed: RPC timed out after 30 seconds"));
    }, 30_000);
    pending.set(request_id, { resolve, reject, timer });
    try {
      current.postMessage({ ...request, request_id });
    } catch (error) {
      void stop_worker(worker_error(error));
    }
  });
}

/** 编译后相对入口不依赖 cwd；仅移除文件 Worker 不支持的 input-type 参数。 */
function ensure_worker(): Worker {
  if (worker) return worker;
  try {
    const exec_argv: string[] = [];
    for (let index = 0; index < process.execArgv.length; index += 1) {
      const argument = process.execArgv[index]!;
      if (argument === "--input-type") { index += 1; continue; }
      if (!argument.startsWith("--input-type=")) exec_argv.push(argument);
    }
    const current = new Worker(new URL("./InteractionWorker.js", import.meta.url), { execArgv: exec_argv });
    worker = current;
    current.on("message", (response: SessionInteractionResponse) => {
      if (worker !== current) return;
      const request = pending.get(response.request_id);
      if (!request) return;
      pending.delete(response.request_id);
      clearTimeout(request.timer);
      if (response.error !== undefined) request.reject(new Error(response.error));
      else if (!Array.isArray(response.items)) request.reject(worker_error("Missing batch result"));
      else request.resolve(response.items);
      schedule_idle();
    });
    current.on("error", (error) => {
      if (worker === current) void stop_worker(worker_error(error));
    });
    current.on("exit", (code) => {
      if (worker === current) void stop_worker(worker_error(`Worker exited (${code})`));
    });
    return current;
  } catch (error) {
    throw worker_error(error);
  }
}

/** 无物理请求且无操作时才进入空闲；定时器和线程均不保活进程。 */
function schedule_idle(): void {
  if (admissions.size || pending.size || !worker) return;
  worker.unref();
  if (idle_timer) clearTimeout(idle_timer);
  idle_timer = setTimeout(() => {
    void stop_worker(worker_error("Idle TTL elapsed"));
  }, 120_000);
  idle_timer.unref();
}

/** 先锁住重启边界，再拒绝调用，保证回调重入也不能创建第二个线程。 */
async function stop_worker(error: Error): Promise<void> {
  if (stopping) return await stopping;
  const current = worker;
  worker = undefined;
  if (idle_timer) clearTimeout(idle_timer);
  idle_timer = undefined;
  const termination = current ? current.terminate().then(() => undefined, () => undefined) : Promise.resolve();
  stopping = termination;
  for (const request of pending.values()) {
    clearTimeout(request.timer);
    request.reject(error);
  }
  pending.clear();
  for (const fail of [...admissions]) fail(error);
  try {
    await termination;
  } finally {
    stopping = undefined;
  }
}

/** 仅线程与调度故障添加专属前缀，业务 Reader 错误保持原文。 */
function worker_error(error: unknown): Error {
  return new Error(`session_interaction_worker_failed: ${error instanceof Error ? error.message : String(error)}`);
}
