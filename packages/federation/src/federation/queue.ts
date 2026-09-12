/**
 * Federation Queue 模块。
 *
 * Queue 是 Federation 级异步任务能力。消息只描述一次 Service Action 调用，
 * 真实发送由 adapter 负责，消费时由 queue.call() 复用现有 Action 执行模型。
 *
 * 能力模型（中文）
 * - `external`：显式调用 `use(adapter)` 注册了外部队列（如 Cloudflare Queue）。
 * - `in_process`：长期运行宿主（Node / CLI / Desktop）的默认能力，用定时器在进程内调度。
 * - `unavailable`：请求级隔离运行时（Cloudflare Workers 等）且未注册外部 adapter。
 *   此时不做静默降级：`send()` 与 `require_available()` 都会抛出可定位错误。
 */

import type { CityTableApi } from "../store/table-api.js";
import type { Action } from "../service/action.js";
import type { Context, Service } from "../service/service.js";
import { InstallableService } from "../service/installable-service.js";
import type { EnvProvider } from "./runtime.js";
import type { FederationStorage } from "./storage.js";
import { detect_dispatch_environment } from "./dispatch-environment.js";
import { InProcessQueueAdapter } from "./queue-in-process.js";

/** Queue 消息。 */
export interface CityQueueMessage {
  /** 目标 Service ID。 */
  service: string;
  /** 目标 Action ID。 */
  action: string;
  /** 传给 Action 的输入。 */
  input?: Record<string, unknown>;
  /** 建议延迟投递毫秒数。 */
  delay_ms?: number;
}

/** Queue 发送 adapter。 */
export interface CityQueueAdapter {
  /** 把消息发送到真实队列。 */
  send(message: CityQueueMessage): Promise<void>;
}

/** Federation 异步调度能力状态。 */
export type CityQueueState =
  /** 已注册外部队列 adapter。 */
  | "external"
  /** 长期运行宿主的进程内调度能力。 */
  | "in_process"
  /** 当前运行时既无外部 adapter，也不支持进程内调度。 */
  | "unavailable";

/**
 * 异步调度能力不可用错误。
 *
 * 关键点（中文）
 * - 带稳定 `code`，供服务侧把系统能力缺失与业务失败区分开（应映射为 503 而非 502）。
 * - `missing` 明确指出缺失项与配置位置，避免调用方只能看到笼统 5xx。
 */
export class FederationQueueUnavailableError extends Error {
  /** 稳定错误码，供上层分类。 */
  readonly code = "async_dispatch_unavailable";

  constructor() {
    super(
      [
        "异步调度能力不可用：当前运行时无法在请求结束后继续执行后台任务，且未注册队列 adapter。",
        "缺失项：Federation queue adapter。",
        "修复方式：Cloudflare Workers 部署请在 federation.json 中声明 queue 资源并把 DOWNCITY_QUEUE 交回 federation.queue.call()；",
        "本地 Node 宿主无需配置，会自动使用进程内调度。",
      ].join(" "),
    );
    this.name = "FederationQueueUnavailableError";
  }
}

/** Queue 调用依赖。 */
interface FederationQueueDeps {
  /** 获取 Federation 是否已 ready。 */
  ensure_ready(): Promise<void>;
  /** 获取 Service 列表。 */
  get_services(): Service[];
  /** 获取表映射。 */
  get_table_map(): Map<string, CityTableApi>;
  /** 获取 env provider。 */
  get_env(): EnvProvider;
  /** Queue 自身 facade。 */
  get_queue(): FederationQueue;
  /** 获取 Federation 默认 storage。 */
  get_storage(): FederationStorage | undefined;
}

/**
 * Federation Queue facade。
 */
export class FederationQueue {
  /** 外部注册的队列 adapter；注册即进入 external 状态。 */
  private adapter?: CityQueueAdapter;
  /** 延迟创建的进程内适配器。 */
  private in_process?: InProcessQueueAdapter;
  /** 是否已释放；释放后不再接受新消息，避免生命周期重启。 */
  private disposed = false;

  constructor(private readonly deps: FederationQueueDeps) {}

  /**
   * 注册真实 Queue adapter。
   *
   * 说明（中文）
   * - 调用后调度能力固定为 external，不再使用进程内调度。
   */
  use(adapter: CityQueueAdapter): this {
    this.adapter = adapter;
    return this;
  }

  /** 当前异步调度能力状态。 */
  get state(): CityQueueState {
    if (this.adapter) return "external";
    if (this.in_process) return "in_process";
    return detect_dispatch_environment() === "long_lived"
      ? "in_process"
      : "unavailable";
  }

  /** 当前是否具备异步调度能力。 */
  is_available(): boolean {
    return this.state !== "unavailable";
  }

  /**
   * 断言调度能力可用。
   *
   * 关键点（中文）
   * - 供服务侧在产生任何副作用之前调用，实现「能力缺失必须前置失败」。
   * - 这是断言而不是查询：不需要调用方自己分支，只负责在不可用时抛出可定位错误。
   */
  require_available(): void {
    if (!this.is_available()) throw new FederationQueueUnavailableError();
  }

  /**
   * 发送一条异步 Action 消息。
   *
   * 说明（中文）
   * - 外部 adapter 的发送失败会向上冒泡，由调用方记录并重试。
   * - 进程内适配器只负责排入定时器，不等待任务执行完成。
   */
  async send(message: CityQueueMessage): Promise<void> {
    if (this.adapter) return await this.adapter.send(message);
    return await this.ensure_in_process().send(message);
  }

  /**
   * 释放进程内调度器并清理未触发的定时器。
   *
   * 关键点（中文）
   * - 幂等且终态：释放后不再重建适配器，避免「已释放又恢复调度」的悬挂状态。
   */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.in_process?.dispose();
    this.in_process = undefined;
  }

  /** 延迟创建进程内适配器；不可用宿主上注册 adapter 后即前置失败。 */
  private ensure_in_process(): InProcessQueueAdapter {
    if (this.disposed) throw new Error("Federation queue has been disposed");
    this.require_available();
    this.in_process ??= new InProcessQueueAdapter({
      deliver: (message) => this.call(message),
      on_error: (error, message) => {
        // 关键点（中文）：此时调用方已收到受理结果，失败必须显式上报而非静默丢弃。
        console.error(
          `[FederationQueue] in-process delivery failed :: ${message.service}/${message.action} :: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      },
    });
    return this.in_process;
  }

  /**
   * 消费一条 Queue 消息，并执行对应 Service Action。
   */
  async call(message: CityQueueMessage): Promise<unknown> {
    await this.deps.ensure_ready();
    const services = this.deps.get_services();
    const service = services.find((item) => item.id === message.service);
    if (!service) throw new Error(`Unknown queue service: ${message.service}`);
    const action = service.get(message.action);
    if (!action) throw new Error(`Unknown queue action: ${message.service}.${message.action}`);
    const ctx = this.createContext(service, action, message);
    return await runServiceAction(services, service, action, ctx);
  }

  /**
   * 为 Queue 消息构造后台 Context。
   */
  private createContext(service: Service, action: Action, message: CityQueueMessage): Context {
    const db: Record<string, CityTableApi> = {};
    const table_map = this.deps.get_table_map();
    if (service.tables) {
      for (const name of Object.keys(service.tables)) {
        db[name] = table_map.get(`${service.id}.${name}`)!;
      }
    }

    return {
      input: message.input ?? {},
      locals: { queue: true },
      db,
      identity: { kind: "admin" },
      env: (key) => this.deps.get_env().get(key),
      service: { id: service.id, name: service.name },
      action: { id: action.id },
      queue: this.deps.get_queue(),
      storage: this.deps.get_storage(),
      started_at: new Date(),
    };
  }
}

/**
 * 按照 HTTP Action 相同顺序执行 hook 与 action。
 */
export async function runServiceAction(
  services: Service[],
  service: Service,
  action: Action,
  ctx: Context,
): Promise<unknown> {
  try {
    for (const hook of globalServiceHooks(services)) {
      await hook.runBefore(ctx);
    }
    await action.hook.runBefore(ctx);
    await service.hook.runBefore(ctx);

    const output = await action.run(ctx);
    ctx.output = output;
    ctx.ended_at = new Date();

    await service.hook.runAfter(ctx);
    await action.hook.runAfter(ctx);
    for (const hook of globalServiceHooks(services)) {
      await hook.runAfter(ctx);
    }

    return output;
  } catch (error) {
    ctx.ended_at = new Date();
    ctx.error = error instanceof Error ? error : new Error(String(error));
    await service.hook.runOnError(ctx);
    await action.hook.runOnError(ctx);
    for (const hook of globalServiceHooks(services)) {
      await hook.runOnError(ctx);
    }
    throw error;
  }
}

/**
 * 收集全局 hook。
 */
function globalServiceHooks(services: Service[]): InstallableService["globalHook"][] {
  return services
    .filter((service): service is InstallableService => service instanceof InstallableService)
    .map((service) => service.globalHook);
}
