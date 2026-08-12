/**
 * Federation Queue 模块。
 *
 * Queue 是 Federation 级异步任务能力。消息只描述一次 Service Action 调用，
 * 真实发送由 adapter 负责，消费时由 queue.call() 复用现有 Action 执行模型。
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
  private adapter?: CityQueueAdapter;

  constructor(private readonly deps: FederationQueueDeps) {}

  /**
   * 注册真实 Queue adapter。
   */
  use(adapter: CityQueueAdapter): this {
    this.adapter = adapter;
    return this;
  }

  /**
   * 发送一条异步 Action 消息。
   */
  async send(message: CityQueueMessage): Promise<void> {
    if (!this.adapter) throw new Error("Federation queue adapter is not configured");
    await this.adapter.send(message);
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
