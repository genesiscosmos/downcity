/**
 * Hook 模块。
 *
 * Hook 是执行生命周期中可注册的回调链，支持 before / after / onError 三个阶段。
 * 所有 hook 函数接收 Context，不返回值（直接在 ctx 上修改）。
 */

import type { Context } from "./service.js";

/** Hook 回调函数 */
export type HookFn = (ctx: Context) => void | Promise<void>;

export class Hook {
  private befores: HookFn[] = [];
  private afters: HookFn[] = [];
  private errors: HookFn[] = [];

  before(fn: HookFn): this {
    this.befores.push(fn);
    return this;
  }

  after(fn: HookFn): this {
    this.afters.push(fn);
    return this;
  }

  onError(fn: HookFn): this {
    this.errors.push(fn);
    return this;
  }

  async runBefore(ctx: Context): Promise<void> {
    for (const fn of this.befores) {
      await fn(ctx);
    }
  }

  async runAfter(ctx: Context): Promise<void> {
    for (const fn of this.afters) {
      await fn(ctx);
    }
  }

  async runOnError(ctx: Context): Promise<void> {
    for (const fn of this.errors) {
      try { await fn(ctx); } catch { /* 不覆盖原始错误 */ }
    }
  }

  /** 清空所有 hook */
  clear(): this {
    this.befores = [];
    this.afters = [];
    this.errors = [];
    return this;
  }
}
