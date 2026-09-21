/**
 * Power 一次调用的身份与执行面。
 *
 * 关键点（中文）
 * - `call` 描述「这一次调用」，与「这一步冻结的事实」（`StepSnapshot`）分开：
 *   一个 Step 可以发起多次调用，因此 per-call 的东西不能放进 per-step 的容器。
 * - 所有入口（模型工具、检查点 hooks、HTTP/RPC、嵌套调用）都提供同一个交互端口；
 *   无 Session 的入口注入拒绝式实现，动作不需要自己判断「有没有人在场」。
 */

import type { SessionInteractionPort } from "@downcity/type";
import { generate_id } from "@/utils/Id.js";
import { create_denied_interaction_port } from "@/power/core/PowerActionInteraction.js";

/** 一次 Power 调用的身份与执行面。 */
export class PowerCall {
  /** 本次调用稳定标识。 */
  readonly id: string;

  /** 本次调用的用户交互端口；无 Session 入口为拒绝式实现。 */
  readonly interactions: SessionInteractionPort;

  /** 本次调用必须监听的取消信号；已合并上游信号与动作超时。 */
  readonly abort_signal: AbortSignal;

  constructor(input: {
    /** 本次调用稳定标识。 */
    readonly id: string;
    /** 本次调用的用户交互端口。 */
    readonly interactions: SessionInteractionPort;
    /** 本次调用的取消信号。 */
    readonly abort_signal: AbortSignal;
  }) {
    this.id = input.id;
    this.interactions = input.interactions;
    this.abort_signal = input.abort_signal;
    Object.freeze(this);
  }
}

/**
 * 由来源身份派生一次调用。
 *
 * 关键点（中文）
 * - 缺少交互端口时注入拒绝式实现，因此动作不需要自己判断「有没有人在场」。
 * - 缺少调用标识时按用途生成，保证日志与诊断可追踪。
 */
export function create_power_call(input: {
  /** 上游调用标识。 */
  readonly call_id?: string;
  /** 上游交互端口。 */
  readonly interactions?: SessionInteractionPort;
  /** 本次调用的取消信号。 */
  readonly abort_signal: AbortSignal;
  /** 生成标识时使用的用途前缀。 */
  readonly label: string;
}): PowerCall {
  return new PowerCall({
    id: String(input.call_id || "").trim() || `${input.label}:${generate_id()}`,
    interactions: input.interactions ?? create_denied_interaction_port(input.label),
    abort_signal: input.abort_signal,
  });
}
