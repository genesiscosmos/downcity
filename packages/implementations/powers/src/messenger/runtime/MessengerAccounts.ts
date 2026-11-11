/**
 * Messenger 所有账号连接的生命周期。
 *
 * 本地状态同步登记，外部连接按账号并行；同一账号的连接、重启和停止共用串行队列。
 * 停止先使在途连接失效并通知 Connector，再等待队列收口后作最终释放。
 * 本模块归 MessengerRuntime 所有，City 仍是 Power initialize/dispose 的唯一入口。
 */
import type { PowerLifecycleContext } from "@downcity/city/power";
import type { BaseMessengerChannel } from "../channels/BaseMessengerChannel.js";
import type { MessengerAccountConfig, MessengerAccountConnectionState } from "../types/MessengerAccount.js";
import type { MessengerConnector } from "../types/MessengerConnector.js";
import type { MessengerStore } from "../storage/MessengerStore.js";

/** 一个账号当前连接的状态；失效实例始终不能回写可靠 Store。 */
interface AccountRuntime {
  /** 当前账号配置快照。 */
  account: MessengerAccountConfig;
  /** 当前平台连接；创建完成前不存在。 */
  connector?: BaseMessengerChannel & MessengerConnector;
  /** 平台权威连接状态或尚未创建连接时的初始状态。 */
  state: MessengerAccountConnectionState;
  /** 最近一次可展示的连接错误。 */
  last_error?: string;
  /** 已连续尝试的自愈重连次数。 */
  reconnect_attempts: number;
  /** 下一次允许自愈重连的时间戳。 */
  next_reconnect_at: number;
  /** 配置错误不自动重试，等待用户修改配置。 */
  reconnect_allowed: boolean;
  /** 已被停止、重启或卸载失效的连接不再发布任何结果。 */
  cancelled: boolean;
  /** 在途启动被打断时的首次停止任务；最终释放等待它结束。 */
  interruption?: Promise<void>;
  /** 同一 Connector 的并发停止请求共享任务，避免多次 stop 互相交叉。 */
  stopping?: Promise<void>;
}

/** 账号连接管理；不同账号的慢连接互不阻塞。 */
export class MessengerAccounts {
  /** 账号状态目录，也供可靠消息 Worker 解析当前 Connector。 */
  readonly accounts = new Map<string, AccountRuntime>();
  /** 同账号共享的任务尾部，同时覆盖后台启动与健康检查任务。 */
  private readonly operations = new Map<string, Promise<void>>();
  /** 最近的显式重启/停止请求编号，用于跳过已被后续请求替代的排队启动。 */
  private readonly revisions = new Map<string, number>();
  /** 卸载后拒绝新工作，并使在途连接立即失效。 */
  private disposed = false;

  constructor(private readonly input: {
    /** Power 生命周期日志入口。 */
    readonly logger: PowerLifecycleContext["logger"];
    /** 在所有连接任务收口之前保持打开的可靠 Store。 */
    readonly store: MessengerStore;
    /** 创建平台 Connector；网络连接由本模块显式启动。 */
    readonly create_connector: (account: MessengerAccountConfig) => Promise<(BaseMessengerChannel & MessengerConnector) | null>;
    /** 停止账号的临时 typing 租约。 */
    readonly stop_typing: (account_id: string) => void;
  }) {}

  /** 同步发布所有初始状态，再排入相互独立的后台连接任务。 */
  initialize(accounts: MessengerAccountConfig[]): void {
    if (this.disposed) return;
    for (const account of accounts) {
      const runtime = this.create_runtime(account);
      this.accounts.set(account.account_id, runtime);
      // enqueue 已观察并持有后台失败；无需把连接时间加入 Power initialize。
      void this.enqueue(account.account_id, async () => { await this.connect(runtime); }).catch(() => undefined);
    }
  }

  /** 读取连接权威状态，尚未创建 Connector 时保留 connecting/config error。 */
  get_account_state(account_id: string) {
    const runtime = this.accounts.get(account_id.trim());
    if (!runtime) return undefined;
    this.sync_status(runtime);
    return { state: runtime.state, ...(runtime.last_error ? { last_error: runtime.last_error } : {}) };
  }

  /** 重启先打断当前连接，再在同账号队列中释放旧实例并连接新配置。 */
  restart_account(account: MessengerAccountConfig): Promise<void> {
    if (this.disposed) return Promise.reject(new Error("Messenger is shutting down"));
    const revision = this.advance_revision(account.account_id);
    this.interrupt(account.account_id);
    return this.enqueue(account.account_id, async () => {
      if (this.disposed || this.revisions.get(account.account_id) !== revision) return;
      await this.release(account.account_id);
      if (this.disposed || this.revisions.get(account.account_id) !== revision) return;
      const runtime = this.create_runtime(account);
      this.accounts.set(account.account_id, runtime);
      await this.connect(runtime);
    });
  }

  /** 账号独立重启；所有结果收口之后才向调用者报告失败。 */
  async restart_enabled_accounts(): Promise<void> {
    const results = await Promise.allSettled([...this.accounts.values()]
      .filter((runtime) => runtime.account.enabled)
      .map((runtime) => this.restart_account(runtime.account)));
    this.throw_failures(results);
  }

  /** 停止立即使当前连接失效；最终释放在该账号全部在途工作之后执行。 */
  stop_account(account_id: string): Promise<void> {
    account_id = account_id.trim();
    if (!account_id || this.disposed) return Promise.resolve();
    this.advance_revision(account_id);
    this.interrupt(account_id);
    return this.enqueue(account_id, async () => { await this.release(account_id); });
  }

  /** 健康检查只处理空闲账号，独立排队，连接中的账号不被重复重建。 */
  async check_health(): Promise<void> {
    if (this.disposed) return;
    const operations: Promise<void>[] = [];
    for (const runtime of this.accounts.values()) {
      const account_id = runtime.account.account_id;
      if (!runtime.account.enabled || runtime.cancelled || this.operations.has(account_id)) continue;
      this.sync_status(runtime);
      if (runtime.state === "connected") {
        if (runtime.reconnect_attempts > 0) {
          runtime.reconnect_attempts = 0;
          this.input.store.append_activity({ account_id, type: "account_recovered" });
        }
        continue;
      }
      if (runtime.connector?.getExecutorStatus().running || !runtime.reconnect_allowed || Date.now() < runtime.next_reconnect_at) continue;
      operations.push(this.enqueue(account_id, async () => {
        if (!this.is_current(runtime)) return;
        runtime.reconnect_attempts += 1;
        const attempt = runtime.reconnect_attempts;
        this.input.store.append_activity({ account_id, type: "account_reconnecting", detail: { attempt, error: runtime.last_error ?? null } });
        await this.stop_connector(runtime);
        runtime.connector = undefined;
        await this.connect(runtime);
        runtime.next_reconnect_at = Date.now() + Math.min(5 * 60_000, 5_000 * 2 ** Math.min(6, attempt - 1));
      }));
    }
    await Promise.allSettled(operations);
  }

  /** 打断全部连接，等待每个账号的队列，再释放所有 Connector。 */
  async dispose(): Promise<void> {
    this.disposed = true;
    for (const account_id of this.accounts.keys()) this.interrupt(account_id);
    await Promise.allSettled([...this.operations.values()]);
    const results = await Promise.allSettled([...this.accounts.keys()].map((account_id) => this.release(account_id)));
    this.throw_failures(results);
  }

  /** 显式请求使排队中的旧启动失效，停止无需等待旧启动实际开始。 */
  private advance_revision(account_id: string): number {
    const revision = (this.revisions.get(account_id) ?? 0) + 1;
    this.revisions.set(account_id, revision);
    return revision;
  }

  /** 所有账号操作都观察失败，并从唯一任务目录移除已完成的尾部。 */
  private enqueue(account_id: string, operation: () => Promise<void>): Promise<void> {
    const result = (this.operations.get(account_id) ?? Promise.resolve()).then(operation);
    const settled = result.catch((error) => {
      this.input.logger.error("Messenger Account lifecycle failed", { account_id, error: String(error) });
    }).then(() => {
      if (this.operations.get(account_id) === settled) this.operations.delete(account_id);
    });
    this.operations.set(account_id, settled);
    return result;
  }

  /** 生成初始连接快照；每次重启重置退避。 */
  private create_runtime(account: MessengerAccountConfig): AccountRuntime {
    return { account, state: account.enabled ? "connecting" : "disabled", reconnect_attempts: 0, next_reconnect_at: 0, reconnect_allowed: true, cancelled: false };
  }

  /** 连接每个 await 之后检查身份；迟到的 Connector 只释放，不发布状态。 */
  private async connect(runtime: AccountRuntime): Promise<void> {
    if (!runtime.account.enabled || !this.is_current(runtime)) return;
    const started_at = performance.now();
    runtime.state = "connecting";
    try {
      let connector: (BaseMessengerChannel & MessengerConnector) | null;
      try { connector = await this.input.create_connector(runtime.account); }
      catch (error) { runtime.reconnect_allowed = false; throw error; }
      if (!connector) {
        runtime.reconnect_allowed = false;
        throw new Error("Messenger Account credentials are incomplete");
      }
      runtime.connector = connector;
      if (!this.is_current(runtime)) return;
      await connector.start();
      if (!this.is_current(runtime)) return;
      this.sync_status(runtime);
      this.input.store.append_activity({ account_id: runtime.account.account_id, type: "account_started" });
    } catch (error) {
      if (!this.is_current(runtime)) return;
      runtime.state = "error";
      runtime.last_error = error instanceof Error ? error.message : String(error);
      this.input.store.append_activity({ account_id: runtime.account.account_id, type: "account_error", detail: { error: runtime.last_error } });
      this.input.logger.error("Messenger Account startup failed", { account_id: runtime.account.account_id, provider: runtime.account.provider, error: runtime.last_error });
    } finally {
      // stop 可在 start 等待期间先执行；等待第一次停止，再做最终释放，防止迟到启动复活。
      if (!this.is_current(runtime)) {
        await runtime.interruption;
        await this.stop_connector(runtime);
      }
      this.input.logger.info("Messenger Account startup settled", { account_id: runtime.account.account_id, provider: runtime.account.provider, elapsed_ms: Math.round(performance.now() - started_at), state: runtime.state });
    }
  }

  /** 启动与健康检查之外的中断请求同步撤销写入资格。 */
  private interrupt(account_id: string): void {
    const runtime = this.accounts.get(account_id);
    if (!runtime) return;
    runtime.cancelled = true;
    runtime.state = runtime.account.enabled ? "disconnected" : "disabled";
    this.input.stop_typing(account_id);
    if (runtime.connector && !runtime.interruption) {
      runtime.interruption = this.stop_connector(runtime).catch((error) => {
        this.input.logger.warn("Messenger Account interruption failed", { account_id, error: String(error) });
      });
    }
  }

  /** 已完成连接任务之后释放 Connector，失败时保留实例供卸载再次回收。 */
  private async release(account_id: string): Promise<void> {
    const runtime = this.accounts.get(account_id);
    if (!runtime) return;
    runtime.cancelled = true;
    this.input.stop_typing(account_id);
    await runtime.interruption;
    await this.stop_connector(runtime);
    this.accounts.delete(account_id);
    this.input.store.append_activity({ account_id, type: "account_stopped" });
  }

  /** 打断启动与最终释放可能同时要求停止；对同一个在途 stop 只执行一次。 */
  private stop_connector(runtime: AccountRuntime): Promise<void> {
    if (runtime.stopping) return runtime.stopping;
    const connector = runtime.connector;
    if (!connector) return Promise.resolve();
    const operation = Promise.resolve().then(async () => { await connector.stop(); });
    runtime.stopping = operation;
    const clear = () => { if (runtime.stopping === operation) runtime.stopping = undefined; };
    void operation.then(clear, clear);
    return operation;
  }

  /** 当前有效实例才有资格发布连接结果或写入可靠 Store。 */
  private is_current(runtime: AccountRuntime): boolean {
    return !this.disposed && !runtime.cancelled && this.accounts.get(runtime.account.account_id) === runtime;
  }

  /** 无 Connector 时保留本地状态；平台存在时由其报告权威连接状态。 */
  private sync_status(runtime: AccountRuntime): void {
    const status = runtime.connector?.getExecutorStatus();
    if (!status || runtime.cancelled) return;
    runtime.state = status.linkState;
    runtime.last_error = status.linkState === "error" ? status.link_error || "Messenger Account connection failed" : undefined;
  }

  /** 所有独立操作都已收口后再报告错误。 */
  private throw_failures(results: PromiseSettledResult<void>[]): void {
    const errors = results.flatMap((result) => result.status === "rejected" ? [result.reason] : []);
    if (errors.length) throw new AggregateError(errors, "Messenger Account lifecycle failed");
  }
}
