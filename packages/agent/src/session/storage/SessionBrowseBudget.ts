/**
 * 进程共享浏览调度器：一个懒启动 Worker，最多 64 个列表操作和 64 条 RPC。
 * 每个操作只发送一个有确认的批次，Worker 消息 FIFO 即有界背压；无额外等待队列。
 * file 快照 48 MiB、memory 快照 16 MiB；最后 Store dispose 或空闲两分钟终止 Worker。
 */
import { Worker } from "node:worker_threads";
import type {
  SessionBrowseAdmission, SessionBrowseRequest, SessionBrowseResponse, SessionBrowseWorkerPending,
} from "../../types/store/SessionBrowse.js";
import { SESSION_BROWSE_TTL_MS, SessionBrowseSnapshots } from "./SessionBrowseSnapshots.js";

export const memory_browse_snapshots = new SessionBrowseSnapshots(16 * 1024 * 1024);
const admissions = new Set<SessionBrowseAdmission>();
const pending = new Map<number, SessionBrowseWorkerPending>();
let worker: Worker | undefined;
let stopping: Promise<void> | undefined;
let idle_timer: ReturnType<typeof setTimeout> | undefined;
/** 已发送但尚未确认的清理消息数，硬上限 128。 */
let pending_clears = 0;
let request_sequence = 0;
let file_owners = 0;

/** 注册 Store 生命周期，不启动 Worker；返回幂等释放入口。 */
export function register_session_browse_store(): () => Promise<void> {
  file_owners += 1;
  let released = false;
  return async () => {
    if (released) return;
    released = true;
    file_owners -= 1;
    if (!file_owners) await stop_worker(new Error("session_list_disposed: All file Stores disposed"));
  };
}

/** 全进程最多 64 个列表，Store 内的额外并发由客户端立即拒绝。 */
export function admit_session_browse(file: boolean, fail: (error: Error) => void): () => void {
  if (admissions.size >= 64) throw new Error("session_list_busy: Process permits at most 64 concurrent list operations");
  const admission: SessionBrowseAdmission = { file, fail };
  admissions.add(admission);
  if (file) {
    if (idle_timer) clearTimeout(idle_timer);
    worker?.ref();
  }
  return () => {
    admissions.delete(admission);
    if (file) schedule_idle();
  };
}

/** 取消本 Store 的 RPC，清理立即进入同一 FIFO，不能延迟到新 begin/batch/page 之后。 */
export function clear_session_browse_store(store_id: string, error: Error): void {
  memory_browse_snapshots.clear(store_id);
  for (const [request_id, request] of pending) {
    if (request.store_id !== store_id) continue;
    clearTimeout(request.timer);
    pending.delete(request_id);
    request.reject(error);
  }
  if (!worker) return;
  if (pending_clears >= 128) {
    void stop_worker(new Error("session_list_worker_failed: Clear control capacity exceeded (128 in flight)"));
    return;
  }
  pending_clears += 1;
  try {
    worker.postMessage({ request_id: 0, action: "clear", store_ids: [store_id] });
  } catch (post_error) {
    void stop_worker(worker_error(post_error));
  }
}

/** 发送一条 FIFO RPC；超时或线程故障拒绝所有受影响操作，不同步回退。 */
export async function request_session_browse(
  request: Omit<SessionBrowseRequest, "request_id">,
): Promise<SessionBrowseResponse> {
  if (stopping) throw new Error("session_list_busy: Shared Worker is terminating");
  if (pending.size >= 64) throw new Error("session_list_busy: Shared Worker FIFO capacity is 64");
  const current = ensure_worker();
  const request_id = ++request_sequence;
  return await new Promise<SessionBrowseResponse>((resolve, reject) => {
    const timer = setTimeout(() => {
      void stop_worker(new Error("session_list_worker_failed: Worker request timed out after 30 seconds"));
    }, 30_000);
    pending.set(request_id, { request_id, store_id: request.query.store_id, resolve, reject, timer });
    try {
      current.postMessage({ ...request, request_id });
    } catch (error) {
      void stop_worker(worker_error(error));
    }
  });
}

/** Worker 只按编译产物相对地址启动，与 cwd、源码目录无关。 */
function ensure_worker(): Worker {
  if (worker) return worker;
  try {
    const current = new Worker(new URL("./BrowseWorker.js", import.meta.url), {
      execArgv: browse_worker_exec_argv(),
    });
    worker = current;
    current.on("message", (response: SessionBrowseResponse) => {
      if (worker !== current) return;
      if (response.request_id === 0) {
        pending_clears -= 1;
        return;
      }
      const request = pending.get(response.request_id);
      if (!request) return;
      pending.delete(response.request_id);
      clearTimeout(request.timer);
      if (response.error) request.reject(new Error(response.error));
      else request.resolve(response);
    });
    current.on("error", (error) => {
      if (worker === current) void stop_worker(worker_error(error));
    });
    current.on("exit", (code) => {
      if (worker === current) void stop_worker(new Error(`session_list_worker_failed: Worker exited (${code})`));
    });
    return current;
  } catch (error) {
    throw worker_error(error);
  }
}

/** 空闲 Worker 不保活进程；TTL 后物理释放所有快照。 */
function schedule_idle(): void {
  if ([...admissions].some((admission) => admission.file) || !worker) return;
  worker.unref();
  if (idle_timer) clearTimeout(idle_timer);
  idle_timer = setTimeout(() => {
    void stop_worker(new Error("session_list_cursor_expired: Shared Worker idle TTL elapsed"));
  }, SESSION_BROWSE_TTL_MS);
  idle_timer.unref();
}

/** 先结算所有挂起调用，再等待 terminate；终止期间禁止新建第二个线程。 */
async function stop_worker(error: Error): Promise<void> {
  if (stopping) return await stopping;
  const current = worker;
  worker = undefined;
  if (idle_timer) clearTimeout(idle_timer);
  idle_timer = undefined;
  pending_clears = 0;
  for (const request of pending.values()) {
    clearTimeout(request.timer);
    request.reject(error);
  }
  pending.clear();
  for (const admission of admissions) if (admission.file) admission.fail(error);
  if (!current) return;
  stopping = current.terminate().then(() => undefined, () => undefined);
  try {
    await stopping;
  } finally {
    stopping = undefined;
  }
}

/** 文件 Worker 不接受 STDIN/eval 专用的 --input-type，其余 loader/调试参数原样保留。 */
function browse_worker_exec_argv(): string[] {
  const result: string[] = [];
  for (let index = 0; index < process.execArgv.length; index += 1) {
    const argument = process.execArgv[index]!;
    if (argument === "--input-type") {
      index += 1;
      continue;
    }
    if (argument.startsWith("--input-type=")) continue;
    result.push(argument);
  }
  return result;
}

/** 跨线程启动和退出故障带稳定错误前缀。 */
function worker_error(error: unknown): Error {
  return new Error(`session_list_worker_failed: ${error instanceof Error ? error.message : String(error)}`);
}
