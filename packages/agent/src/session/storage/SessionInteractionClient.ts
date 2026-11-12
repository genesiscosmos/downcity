/**
 * 每个文件 Store 的交互扫描生命周期：一个执行项、最多八个等待项。
 * 宿主只枚举所有活动分类并逐批发送；不保存 pending 事实，不提前排序或截断。
 * 取消立即拒绝调用方，执行项在 FileSystem/RPC 返回并检查失效后才释放容量。
 */
import type { AgentInteraction } from "../../types/agent/AgentInteractions.js";
import type {
  SessionInteractionCandidate, SessionInteractionEntry, SessionInteractionOptions,
} from "../../types/store/SessionInteractionQuery.js";
import { get_agent_session_categories_path, get_agent_session_database_path } from "./LocalStorePaths.js";
import {
  admit_session_interaction, register_session_interaction_store, request_session_interactions,
} from "./SessionInteractionWorkerRuntime.js";

/** 不拥有数据库连接，只拥有扫描、世代和共享线程 owner。 */
export class SessionInteractionClient {
  /** 破坏性修改前后递增，所有异步检查点必须匹配。 */
  private generation = 0;
  /** 进行中的破坏性修改数，期间拒绝新扫描。 */
  private mutations = 0;
  /** Store 永久终态。 */
  private disposed = false;
  /** 有界等待队列，不使用无界 Promise tail。 */
  private queue: SessionInteractionEntry[] = [];
  /** 唯一执行项，取消后仍等待底层物理工作结束。 */
  private active_entry?: SessionInteractionEntry;
  /** 当前串行消费器，用于 dispose 等待本 Store 工作收口。 */
  private draining?: Promise<void>;
  /** 注册时不启动线程的幂等 owner 释放入口。 */
  private readonly release_store = register_session_interaction_store();
  /** 重复 dispose 返回同一完成结果。 */
  private disposal?: Promise<void>;

  constructor(private readonly options: SessionInteractionOptions) {}

  /** 所有删除、归档、清空操作前后均失效，包含部分失败的修改。 */
  async mutate<T>(action: () => Promise<T>): Promise<T> {
    if (this.disposed) throw new Error("session_interaction_disposed: Store is disposed");
    this.mutations += 1;
    this.invalidate();
    try {
      return await action();
    } finally {
      this.mutations -= 1;
      this.invalidate();
    }
  }

  /** 排队和执行共用两分钟总时限；全部等待项计入进程准入。 */
  async list(): Promise<AgentInteraction[]> {
    this.check_available();
    if ((this.active_entry ? 1 : 0) + this.queue.length >= 9) {
      throw new Error("session_interaction_busy: Store permits one active operation and 8 queued requests");
    }
    return await new Promise<AgentInteraction[]>((resolve, reject) => {
      let settled = false;
      let entry!: SessionInteractionEntry;
      const release = admit_session_interaction((error) => entry.cancel(error));
      const timer = setTimeout(() => {
        entry.cancel(new Error("session_interaction_timeout: Queue and scan exceeded two minutes"));
      }, 120_000);
      entry = {
        generation: this.generation,
        release,
        resolve: (items) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          resolve(items);
        },
        cancel: (error) => {
          if (settled) return;
          settled = true;
          entry.failure = error;
          clearTimeout(timer);
          if (this.active_entry !== entry) {
            this.queue = this.queue.filter((item) => item !== entry);
            release();
          }
          reject(error);
        },
      };
      this.queue.push(entry);
      this.start_drain();
    });
  }

  /** 调用结果的接收者可立即再次排队；收尾时再次检查，防止微任务间隙丢失唤醒。 */
  private start_drain(): void {
    if (this.draining || !this.queue.length || this.disposed) return;
    this.draining = this.drain().finally(() => {
      this.draining = undefined;
      this.start_drain();
    });
  }

  /** 不 race 掉底层工作，避免反复取消产生脱离所有权的枚举和在途 RPC。 */
  private async drain(): Promise<void> {
    let entry: SessionInteractionEntry | undefined;
    while ((entry = this.queue.shift())) {
      this.active_entry = entry;
      try {
        entry.resolve(await this.scan(entry));
      } catch (error) {
        entry.cancel(error instanceof Error ? error : new Error(String(error)));
      } finally {
        entry.release();
        this.active_entry = undefined;
      }
    }
  }

  /** 顺序沿用 FileSystem 枚举顺序及严格 Reader 内部顺序，结果只在全成功后返回。 */
  private async scan(entry: SessionInteractionEntry): Promise<AgentInteraction[]> {
    const check = () => {
      if (entry.failure) throw entry.failure;
      this.check_available();
      if (entry.generation !== this.generation) throw invalidated_error();
    };
    check();
    const result: AgentInteraction[] = [];
    for await (const candidates of this.enumerate(check)) {
      check();
      const items = await request_session_interactions({ agent_id: this.options.agent_id, candidates });
      check();
      for (const item of items) result.push(item);
    }
    check();
    return result;
  }

  /** 所有 FileSystem await 后均检查终态/世代；每批最多 32 条、256 KiB（含数组结构）。 */
  private async *enumerate(check: () => void): AsyncGenerator<SessionInteractionCandidate[]> {
    const { files, storage_root_path } = this.options;
    const root = get_agent_session_categories_path(storage_root_path);
    const exists = await files.path_exists(root);
    check();
    if (!exists) return;
    const partitions = await files.read_directory(root);
    check();
    let batch: SessionInteractionCandidate[] = [];
    let bytes = 2;
    for (const partition of partitions) {
      check();
      if (!partition.is_directory) continue;
      const category = decode_directory_id(partition.name);
      const entries = await files.read_directory(`${root}/${partition.name}`);
      check();
      for (const entry of entries) {
        check();
        if (!entry.is_directory) continue;
        const session_id = decode_directory_id(entry.name);
        const database_path = get_agent_session_database_path(storage_root_path, category, session_id);
        const database_exists = await files.path_exists(database_path);
        check();
        if (!database_exists) continue;
        const candidate = { database_path, session_id, category };
        const size = Buffer.byteLength(JSON.stringify(candidate), "utf8");
        if (size + 2 > 256 * 1024) {
          throw new Error("session_interaction_candidate_too_large: Candidate exceeds 256 KiB");
        }
        if (batch.length && (batch.length >= 32 || bytes + size + 1 > 256 * 1024)) {
          yield batch;
          check();
          batch = [];
          bytes = 2;
        }
        bytes += size + (batch.length ? 1 : 0);
        batch.push(candidate);
      }
    }
    if (batch.length) yield batch;
  }

  /** dispose 立即拒绝调用；等待本 Store 的物理工作及最后 owner 的线程退出。 */
  dispose(): Promise<void> {
    if (this.disposal) return this.disposal;
    this.disposed = true;
    this.cancel_all(new Error("session_interaction_disposed: Store is disposed"));
    this.disposal = Promise.all([this.release_store(), this.draining]).then(() => undefined);
    return this.disposal;
  }

  /** 修改期间拒绝扫描；前后世代分别覆盖开始前和部分修改后的旧读取。 */
  private invalidate(): void {
    this.generation += 1;
    this.cancel_all(invalidated_error());
  }

  /** 取消等待项立即归还准入，执行项由 drain 的 finally 结算。 */
  private cancel_all(error: Error): void {
    this.active_entry?.cancel(error);
    for (const entry of [...this.queue]) entry.cancel(error);
  }

  /** dispose 是永久终态，不允许重新注册共享线程。 */
  private check_available(): void {
    if (this.disposed) throw new Error("session_interaction_disposed: Store is disposed");
    if (this.mutations) throw invalidated_error();
  }
}

/** 保持原 Store 对目录编码失败的处理，交由严格 Reader 校验实际身份。 */
function decode_directory_id(input: string): string {
  try { return decodeURIComponent(input); } catch { return input; }
}

/** 失效必须显式失败，不能返回部分结果或把失败解释成无 pending。 */
function invalidated_error(): Error {
  return new Error("session_interaction_invalidated: Store changed during scan");
}
