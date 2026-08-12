/**
 * Service 公共类型。
 */

import type { Context } from "./service.js";

/**
 * Hook 回调函数。
 *
 * 接收 Context，不返回值。如需修改上下文，直接在 ctx 上改。
 */
export type HookFn = (ctx: Context) => void | Promise<void>;
