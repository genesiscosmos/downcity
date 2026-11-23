/**
 * 原始 Power 的最薄宿主身份适配。原实例保持只读身份，SDK 基类负责以宿主 ID
 * 编译工具/hooks；动作保持原声明的接收者，生命周期方法保持原实例接收者。
 */
import { Power } from "../../power/Power.js";
import type { PowerDefinition } from "../../power/index.js";
import type { PowerActions } from "../../power/types/PowerRuntime.js";
import type { PowerContext } from "../../power/types/PowerContext.js";
import type { PowerLifecycleContext } from "../../power/types/PowerHost.js";
import type { StepSnapshot } from "../../power/types/StepSnapshot.js";
import { track_extension_stream, ExtensionGate } from "./ExtensionGate.js";

/** City 独占初始化和释放此适配器，项目运行层不重复释放原 Power。 */
export class ExtensionPower extends Power {
  readonly title: string;
  readonly description: string;
  readonly actions: PowerActions;
  readonly hooks: PowerDefinition["hooks"];
  readonly resolves: PowerDefinition["resolves"];
  readonly http: PowerDefinition["http"];

  constructor(readonly name: string, private readonly source: PowerDefinition, private readonly gate: ExtensionGate) {
    super();
    this.title = source.title;
    this.description = source.description;
    const hooks = source.hooks;
    const wrap_handlers = <TInput, TOutput>(groups?: Readonly<Record<string, readonly ((input: TInput) => TOutput | Promise<TOutput>)[]>>) => Object.fromEntries(Object.entries(groups ?? {}).map(([point, handlers]) => [point, handlers.map((handler) => Object.assign(async (input: TInput): Promise<TOutput> => {
      const release = gate.acquire(`power:${name}:hook:${point}`);
      try { return await handler(input); } finally { release(); }
    }, { handler_id: (handler as typeof handler & { /** 完成 hook 的持久幂等身份。 */ handler_id?: string }).handler_id }))]));
    this.hooks = { pipeline: wrap_handlers(hooks?.pipeline), guard: wrap_handlers(hooks?.guard), effect: wrap_handlers(hooks?.effect) };
    this.resolves = Object.fromEntries(Object.entries(source.resolves ?? {}).map(([point, handler]) => [point, async (input) => {
      const release = gate.acquire(`power:${name}:resolve:${point}`);
      try { return await handler(input); } finally { release(); }
    }]));
    this.http = source.http?.server ? { server: { ...source.http.server, register: (input) => {
      input.app.use("*", async (context, next) => {
        const release = gate.acquire(`power:${name}:http`);
        try { await next(); if (context.res.body) context.res = new Response(track_extension_stream(context.res.body, release, context.req.raw.signal), context.res); else release(); }
        catch (error) { release(); throw error; }
      });
      source.http!.server!.register(input);
    } } } : undefined;
    this.actions = Object.fromEntries(Object.entries(source.actions ?? {}).map(([id, action]) => [id, {
      ...action,
      ...(action.execute ? { execute: async (...args: Parameters<NonNullable<typeof action.execute>>) => {
        const release = gate.acquire(`power:${name}.${id}`);
        try { return await action.execute!.apply(action, args); }
        finally { release(); }
      } } : {}),
    }]));
  }

  /** 原始对象接收宿主命名空间上下文。 */
  async initialize(context: PowerLifecycleContext): Promise<void> {
    const wrap = <T>(operation: () => T | Promise<T>, consumer: string) => async () => {
      const release = this.gate.acquire(consumer);
      try { return await operation(); } finally { release(); }
    };
    await this.source.initialize?.({ ...context, get town() { return context.town; }, power: {
      id: context.power.id,
      background: async (operation) => {
        const release = this.gate.acquire(`power:${this.name}:background`, false);
        try { return await context.power.background(operation); } finally { release(); }
      },
      action: (action) => context.power.action({ ...action, run: (input) => wrap(() => action.run(input), `power:${this.name}:host:${action.id}`)() }),
      config_action: (action) => context.power.config_action({ ...action, run: (input, config) => wrap(() => action.run(input, config), `power:${this.name}:config:${action.id}`)() }),
    } });
  }
  /** 只有 City 调用，其他清理路径不重复执行。 */
  async dispose(context: PowerLifecycleContext): Promise<void> { await this.source.dispose?.(context); }
  /** 原始实例可基于当前上下文投影系统提示。 */
  async system(context: PowerContext, snapshot: StepSnapshot): Promise<string> { const release = this.gate.acquire(`power:${this.name}:system`); try { return await this.source.system?.(context, snapshot) ?? ""; } finally { release(); } }
  /** 保持原始动态可用性规则。 */
  async availability(context: PowerContext) { const release = this.gate.acquire(`power:${this.name}:availability`); try { return await this.source.availability?.(context) ?? { enabled: true, available: true, reasons: [] }; } finally { release(); } }
}
