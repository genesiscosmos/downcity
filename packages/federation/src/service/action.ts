/**
 * Action 模块。
 *
 * Action 是 Service 的一等能力单元。
 * 每个 Action 有独立的 hook（before/after/onError），可独立被 client 调用。
 *
 * 使用方式：
 * ```ts
 * const zh2en = translateService.action("zh2en", async (ctx) => {
 *   return await translate(ctx.input.text, "zh", "en");
 * });
 * zh2en.before(checkBalance).after(deductFee);
 * ```
 */

import { Hook } from "./hook.js";
import type { Context } from "./service.js";

/** Action 的业务逻辑函数 */
export type ActionFn = (
  ctx: Context,
) => unknown | Promise<unknown>;

/** Action 实例 */
export class Action {
  /** Action 唯一 ID */
  readonly id: string;
  /** Action 独立的 hook（before/after/onError） */
  readonly hook = new Hook();

  /** 业务逻辑 */
  private readonly _run: ActionFn;

  constructor(id: string, fn: ActionFn) {
    this.id = id;
    this._run = fn;
  }

  /** 注册 before hook */
  before(fn: HookFn): this {
    this.hook.before(fn);
    return this;
  }

  /** 注册 after hook */
  after(fn: HookFn): this {
    this.hook.after(fn);
    return this;
  }

  /** 注册 onError hook */
  onError(fn: HookFn): this {
    this.hook.onError(fn);
    return this;
  }

  /** 执行业务逻辑 */
  async run(ctx: Context): Promise<unknown> {
    return this._run(ctx);
  }
}

/**
 * Hook 回调函数。
 *
 * 接收 Context，不返回值（返回 void 或 Promise<void>）。
 * 如需修改 context，直接在 ctx 上改（如 ctx.output）。
 */
export type HookFn = (ctx: Context) => void | Promise<void>;
