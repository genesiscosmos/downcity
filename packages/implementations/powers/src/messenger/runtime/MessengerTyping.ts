/**
 * Telegram 实时 typing 心跳的内存生命周期。
 *
 * 每个 Account、chat 和 topic 共用一个四秒定时器；不同执行来源分别持有租约。
 * 取消、执行暂停和账号退出都会释放租约。动作不进入可靠 Outbox；失败仅报告一次
 * 固定诊断，不记录平台错误正文。跨租约保留请求锁，避免停止后立即恢复造成并发发送。
 */

/** 一条支持 typing 的 Telegram 路由。 */
export interface MessengerTypingRoute {
  /** 持有平台 Connector 的 Account 稳定标识。 */
  account_id: string;
  /** Telegram 目标 chat 标识。 */
  chat_id: string;
  /** 可选 Forum topic 标识，必须原样路由。 */
  thread_id?: number;
}

/** 当前路由共享的心跳与执行来源。 */
interface TypingEntry {
  /** 当前 Account、chat、topic 的稳定路由。 */
  route: MessengerTypingRoute;
  /** 执行来源到取消监听器清理函数的映射。 */
  sources: Map<string, () => void>;
  /** 每四秒尝试发送的轻量定时器。 */
  timer: ReturnType<typeof setInterval>;
  /** 本次活动窗口是否已经报告过失败，防止重复刷日志。 */
  failure_reported: boolean;
}

/** 按路由共享、按实际执行来源释放的 typing 管理器。 */
export class MessengerTyping {
  /** 正在活动的路由。 */
  private readonly entries = new Map<string, TypingEntry>();
  /** 执行来源到路由的反向索引，释放时不依赖 Conversation 仍然存在。 */
  private readonly source_routes = new Map<string, string>();
  /** 仍未结束的网络请求；路由租约释放后也保留，直到请求完成。 */
  private readonly in_flight = new Set<string>();
  /** 关闭后拒绝新的租约。 */
  private disposed = false;

  constructor(
    private readonly send: (route: MessengerTypingRoute) => Promise<{ /** 本次平台动作是否成功。 */ success: boolean }>,
    private readonly report_failure: () => void,
  ) {}

  /** 幂等持有执行租约，首个来源立即触发 typing。 */
  start(source_key: string, route: MessengerTypingRoute, abort_signal: AbortSignal): void {
    if (this.disposed || abort_signal.aborted || this.source_routes.has(source_key)) return;
    const route_key = JSON.stringify([route.account_id, route.chat_id, route.thread_id ?? null]);
    let entry = this.entries.get(route_key);
    if (!entry) {
      entry = {
        route,
        sources: new Map(),
        timer: setInterval(() => { void this.tick(route_key); }, 4_000),
        failure_reported: false,
      };
      entry.timer.unref?.();
      this.entries.set(route_key, entry);
    }
    const on_abort = () => this.stop(source_key);
    abort_signal.addEventListener("abort", on_abort, { once: true });
    entry.sources.set(source_key, () => abort_signal.removeEventListener("abort", on_abort));
    this.source_routes.set(source_key, route_key);
    if (entry.sources.size === 1) void this.tick(route_key);
  }

  /** 释放一个执行来源；最后一个来源释放时取消整个路由定时器。 */
  stop(source_key: string): void {
    const route_key = this.source_routes.get(source_key);
    if (!route_key) return;
    this.source_routes.delete(source_key);
    const entry = this.entries.get(route_key);
    if (!entry) return;
    entry.sources.get(source_key)?.();
    entry.sources.delete(source_key);
    if (entry.sources.size) return;
    clearInterval(entry.timer);
    this.entries.delete(route_key);
  }

  /** 账号离线时释放全部来源；重新上线需要新的实际执行租约。 */
  stop_account(account_id: string): void {
    for (const entry of this.entries.values()) {
      if (entry.route.account_id !== account_id) continue;
      for (const source_key of entry.sources.keys()) this.stop(source_key);
    }
  }

  /** 关闭所有定时器与取消监听器，不等待非关键的平台动作。 */
  dispose(): void {
    this.disposed = true;
    for (const source_key of this.source_routes.keys()) this.stop(source_key);
  }

  /** 每个路由最多一个在途请求；故障不会冒泡至 Session 执行。 */
  private async tick(route_key: string): Promise<void> {
    const entry = this.entries.get(route_key);
    if (!entry || this.in_flight.has(route_key)) return;
    this.in_flight.add(route_key);
    try {
      const result = await this.send(entry.route);
      if (!result.success) this.warn_once(route_key, entry);
    } catch {
      this.warn_once(route_key, entry);
    } finally {
      this.in_flight.delete(route_key);
    }
  }

  /** 仅记录固定脱敏诊断；旧请求结束时不影响新一代租约。 */
  private warn_once(route_key: string, entry: TypingEntry): void {
    if (this.entries.get(route_key) !== entry || entry.failure_reported) return;
    entry.failure_reported = true;
    try { this.report_failure(); } catch { /* 日志失败也不得影响执行。 */ }
  }
}
