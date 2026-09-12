/**
 * Federation 进程内队列适配器。
 *
 * 关键点（中文）
 * - 为长期运行的宿主提供默认异步调度能力：按 `delay_ms` 用定时器把消息交回
 *   `FederationQueue.call()`，因此不需要任何外部基础设施即可跑通异步任务。
 * - 该能力依赖「进程存活」，只在长期运行宿主启用；请求级隔离运行时必须显式注册
 *   外部队列，否则由 `FederationQueue` 判定为不可用并前置失败，不做静默降级。
 * - 投递是解耦的：`send()` 只负责把消息排入定时器，不等待任务执行完成。
 *   定时器触发后的执行失败无法回传调用方，只能上报；未完成任务由事实源
 *   （`async_jobs` 等）在恢复流程中重新入队，保证最终一致性。
 * - 生命周期必须闭合：`dispose()` 清理所有未触发定时器，不留悬挂 timer。
 */

import type { CityQueueAdapter, CityQueueMessage } from "./queue.js";

/** 进程内适配器依赖。 */
export interface InProcessQueueDeps {
  /**
   * 把消息交给 `FederationQueue.call()` 执行。
   *
   * 说明（中文）
   * - 由 `FederationQueue` 注入，避免适配器与门面互相直接依赖。
   */
  deliver(message: CityQueueMessage): Promise<unknown>;
  /**
   * 定时器触发后的执行失败上报入口。
   *
   * 说明（中文）
   * - 此时 `send()` 早已返回，异常无法抛给调用方，必须显式上报而不是静默吞掉。
   */
  on_error(error: unknown, message: CityQueueMessage): void;
}

/** 进程内延迟队列适配器。 */
export class InProcessQueueAdapter implements CityQueueAdapter {
  /** 尚未触发的定时器；用于优雅关闭时清理。 */
  private readonly timers = new Set<ReturnType<typeof setTimeout>>();
  /** 是否已关闭；关闭后拒绝新消息。 */
  private disposed = false;

  constructor(private readonly deps: InProcessQueueDeps) {}

  /** 把消息排入定时器，到点后交回 `queue.call()`。 */
  async send(message: CityQueueMessage): Promise<void> {
    if (this.disposed) {
      throw new Error("Federation in-process queue has been disposed");
    }
    const delay_ms = normalize_delay_ms(message.delay_ms);
    const timer = setTimeout(() => {
      this.timers.delete(timer);
      void this.run(message);
    }, delay_ms);
    // 关键点（中文）：调度不应阻止宿主进程退出；未完成的任务由恢复流程兜底。
    // 本包同时面向 Node 与 Edge 编译，DOM 类型把 setTimeout 标为 number，
    // 因此此处按能力探测调用 unref，而不是假定它是 Node Timeout 对象。
    unref_timer(timer);
    this.timers.add(timer);
  }

  /** 关闭适配器并清理未触发的定时器。 */
  dispose(): void {
    this.disposed = true;
    for (const timer of this.timers) clearTimeout(timer);
    this.timers.clear();
  }

  /** 执行一次投递；失败只上报，绝不产生未处理的 Promise 拒绝。 */
  private async run(message: CityQueueMessage): Promise<void> {
    try {
      await this.deps.deliver(message);
    } catch (error) {
      this.deps.on_error(error, message);
    }
  }
}

/** 归一化延迟毫秒数：非有限值或非正数一律按 0（尽快执行）处理。 */
function normalize_delay_ms(value: number | undefined): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return 0;
  return Math.trunc(parsed);
}

/**
 * 在 Node 下将定时器标记为不阻止进程退出。
 *
 * 说明（中文）
 * - 只有 Node 的 Timeout 对象提供 unref；Edge 与浏览器环境没有该能力。
 * - DOM 类型将 setTimeout 声明为 number，因此这里做一次受控的能力探测。
 */
function unref_timer(timer: ReturnType<typeof setTimeout>): void {
  const maybe = timer as unknown as { unref?: () => void };
  maybe.unref?.();
}
