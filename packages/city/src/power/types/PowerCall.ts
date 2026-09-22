/**
 * Power 一次调用的身份与执行面。
 *
 * 关键点（中文）
 * - `call` 描述「这一次调用」，与「这一步冻结的事实」（`StepSnapshot`）分开：
 *   一个 Step 可以发起多次调用，因此 per-call 的东西不能放进 per-step 的容器。
 * - 所有入口（模型工具、检查点 hooks、HTTP/RPC、嵌套调用）都提供同一个交互端口；
 *   无 Session 的入口注入拒绝式实现，动作不需要自己判断「有没有人在场」。
 * - 调用身份分两层：`tool_call_id` 是上游模型协议给出的真实标识，容器绝不合成；
 *   `trace_id` 只用于日志关联，两者不可互相顶替。
 */

import type { SessionInteractionPort } from "@downcity/type";
import { generate_id } from "@/utils/Id.js";
import { create_denied_interaction_port } from "@/power/core/PowerActionInteraction.js";

/** 一次 Power 调用的身份与执行面。 */
export class PowerCall {
  /**
   * 上游模型协议分配的工具调用标识；非工具入口（HTTP/RPC/hook）为空。
   *
   * 关键点（中文）：审批需要用它回查真实 Tool Part，因此缺失时必须保持为空，
   * 不能用任何本地生成的字符串顶替。
   */
  readonly tool_call_id?: string;

  /** 本次调用的诊断标识，仅用于日志关联，不参与审批归属与身份判断。 */
  readonly trace_id: string;

  /** 本次调用的用户交互端口；无 Session 入口为拒绝式实现。 */
  readonly interactions: SessionInteractionPort;

  /** 本次调用必须监听的取消信号；已合并上游信号与动作超时。 */
  readonly abort_signal: AbortSignal;

  constructor(input: {
    /** 上游工具调用标识；缺失表示本次调用不属于任何模型工具调用。 */
    readonly tool_call_id?: string;
    /** 本次调用的诊断标识。 */
    readonly trace_id: string;
    /** 本次调用的用户交互端口。 */
    readonly interactions: SessionInteractionPort;
    /** 本次调用的取消信号。 */
    readonly abort_signal: AbortSignal;
  }) {
    if (input.tool_call_id !== undefined) this.tool_call_id = input.tool_call_id;
    this.trace_id = input.trace_id;
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
 * - `tool_call_id` 只在入口真的提供时才有值；容器不合成调用身份，
 *   否则审批会拿一个查不到的标识去关联 Tool Part。
 */
export function create_power_call(input: {
  /** 上游工具调用标识。 */
  readonly tool_call_id?: string;
  /** 上游交互端口。 */
  readonly interactions?: SessionInteractionPort;
  /** 本次调用的取消信号。 */
  readonly abort_signal: AbortSignal;
  /** 生成诊断标识时使用的用途前缀。 */
  readonly label: string;
}): PowerCall {
  const tool_call_id = String(input.tool_call_id || "").trim();
  return new PowerCall({
    ...(tool_call_id ? { tool_call_id } : {}),
    trace_id: `${input.label}:${generate_id()}`,
    interactions: input.interactions ?? create_denied_interaction_port(input.label),
    abort_signal: input.abort_signal,
  });
}
