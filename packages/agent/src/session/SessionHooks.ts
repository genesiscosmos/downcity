/**
 * Session Hook 运行类。
 *
 * SessionHooks 是 Agent 对 Hook 的唯一认识。默认实例不产生任何行为；City 等上层
 * 组合根可以注入处理函数，并在 open() 时为单个 Step 捕获稳定作用域。
 */

import type {
  JsonValue,
  SessionHookContext,
  SessionHookHandlers,
  SessionHookRuntime,
  SessionHookScopeRuntime,
  SessionSystemBlock,
} from "@downcity/type";

/** 单个 Session Step 捕获的稳定 Hook 作用域。 */
export class SessionHookScope implements SessionHookScopeRuntime {
  /** 当前作用域是否已经关闭。 */
  private closed = false;

  constructor(private readonly handlers: SessionHookHandlers = {}) {}

  /** 读取当前作用域提供的 system blocks。 */
  async system_blocks(context?: SessionHookContext): Promise<SessionSystemBlock[]> {
    return await this.handlers.system_blocks?.(context) ?? [];
  }

  /** 运行一个可转换值的 Hook。 */
  async pipeline<TValue = JsonValue>(point_name: string, value: TValue): Promise<TValue> {
    return this.handlers.pipeline
      ? await this.handlers.pipeline(point_name, value)
      : value;
  }

  /** 运行一个只产生副作用的 Hook。 */
  async effect<TValue = JsonValue>(point_name: string, value: TValue): Promise<void> {
    await this.handlers.effect?.(point_name, value);
  }

  /** 幂等关闭当前作用域。 */
  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    await this.handlers.close?.();
  }
}

/** Session 级 Hook 集合。 */
export class SessionHooks implements SessionHookRuntime {
  constructor(private readonly handlers: SessionHookHandlers = {}) {}

  /** 读取当前配置提供的 system blocks。 */
  async system_blocks(context?: SessionHookContext): Promise<SessionSystemBlock[]> {
    return await this.handlers.system_blocks?.(context) ?? [];
  }

  /** 运行一个可转换值的 Hook。 */
  async pipeline<TValue = JsonValue>(point_name: string, value: TValue): Promise<TValue> {
    return this.handlers.pipeline
      ? await this.handlers.pipeline(point_name, value)
      : value;
  }

  /** 运行一个只产生副作用的 Hook。 */
  async effect<TValue = JsonValue>(point_name: string, value: TValue): Promise<void> {
    await this.handlers.effect?.(point_name, value);
  }

  /** 为下一个 Session Step 打开稳定 Hook 作用域。 */
  async open(): Promise<SessionHookScope> {
    const scoped_handlers = await this.handlers.open?.();
    if (scoped_handlers) return new SessionHookScope(scoped_handlers);
    return new SessionHookScope({
      system_blocks: async (context) => await this.system_blocks(context),
      pipeline: async <TValue>(point_name: string, value: TValue) =>
        await this.pipeline(point_name, value),
      effect: async <TValue>(point_name: string, value: TValue) =>
        await this.effect(point_name, value),
    });
  }
}

/** 不提供任何 Hook 的默认实例。 */
export const EMPTY_SESSION_HOOKS = new SessionHooks();
