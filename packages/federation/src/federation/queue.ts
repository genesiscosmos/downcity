/**
 * Federation Queue 模块。
 *
 * Queue 是 Federation 级异步任务能力：消息只描述一次 Service Action 调用，
 * 真实发送由 adapter 负责，消费时由 queue.call() 复用现有 Action 执行模型。
 *
 * 能力模型（中文）
 * - 能力来自宿主显式注册的 adapter（如 Cloudflare Queue）。Federation 只提供机制，
 *   不判断宿主平台，也不拥有任何隐式兜底策略。
 * - 未注册 adapter 时能力不可用：`send()` 与 `require_available()` 抛出带 code 的
 *   可定位错误，让调用方在产生副作用之前失败。
 */

import type { CityTableApi } from "../store/table-api.js";
import type { Action } from "../service/action.js";
import type { Context, Service } from "../service/service.js";
import { InstallableService } from "../service/installable-service.js";
import type { EnvProvider } from "./runtime.js";
import type { FederationStorage } from "./storage.js";

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

/**
 * 异步调度能力不可用错误。
 *
 * 关键点（中文）
 * - 带稳定 `code`，供服务侧把系统能力缺失与业务失败区分开（应映射为 503 而非 502）。
 */
export class FederationQueueUnavailableError extends Error {
  /** 稳定错误码，供上层分类。 */
  readonly code = "async_dispatch_unavailable";

  constructor() {
    super("异步调度能力不可用：当前 Federation 未注册队列 adapter。");
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
  /** 宿主显式注册的队列 adapter；注册即具备调度能力。 */
  private adapter?: CityQueueAdapter;

  constructor(private readonly deps: FederationQueueDeps) {}

  /**
   * 注册真实 Queue adapter。
   *
   * 说明（中文）
   * - 这是 Federation 获得异步调度能力的唯一方式：能力由宿主显式声明，
   *   Federation 不替宿主判断运行时类型。
   */
  use(adapter: CityQueueAdapter): this {
    this.adapter = adapter;
    return this;
  }

  /** 当前是否具备异步调度能力。 */
  is_available(): boolean {
    return this.adapter !== undefined;
  }

  /**
   * 断言调度能力可用。
   *
   * 关键点（中文）
   * - 供服务侧在产生任何副作用之前调用，实现「能力缺失必须前置失败」。
   * - 这是断言而不是查询：不需要调用方自己分支，只负责在不可用时抛出可定位错误。
   */
  require_available(): void {
    if (!this.adapter) throw new FederationQueueUnavailableError();
  }

  /**
   * 发送一条异步 Action 消息。
   *
   * 说明（中文）
   * - 未注册 adapter 时前置失败，不做隐式兜底。
   * - adapter 的发送失败会向上冒泡，由调用方记录并按自身策略重试。
   */
  async send(message: CityQueueMessage): Promise<void> {
    this.require_available();
    return await this.adapter!.send(message);
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
