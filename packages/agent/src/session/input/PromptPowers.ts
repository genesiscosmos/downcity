/**
 * 请求级 Power 的描述校验、Action 执行与 Turn 作用域。
 * 描述采用 JSON 快照；函数留在提供方，不进入 Session 的长期工具注册表。
 */
import { randomUUID } from "node:crypto";
import type { AgentSessionPromptInput } from "@/types/sdk/AgentSessionPrompt.js";
import { z } from "zod";
import type { AgentTool, ModelJsonValue, PromptPower, PromptPowerDescriptor, PromptPowerCallContext, SessionHookContextBlock } from "@downcity/type";
import type { SessionTurnContext } from "@/types/turn/SessionTurnContext.js";

const scopes = new WeakMap<SessionTurnContext, readonly PromptPower[]>();
const scope_cleanups = new WeakMap<SessionTurnContext, () => void>();
import { describe_prompt_powers, execute_prompt_power } from "@/power/PromptPowerExecution.js";
export { describe_prompt_powers, snapshot_prompt_powers, execute_prompt_power } from "@/power/PromptPowerExecution.js";

/** 只在首条 Prompt 接收时设置本轮作用域。 */
export function set_turn_prompt_powers(context: SessionTurnContext, powers: readonly PromptPower[]): void {
  scopes.set(context, powers);
  const removers = powers.map((power) => {
    const signal = power.abort_signal;
    const abort = () => context.lifecycle.abort(signal?.reason ?? new Error("Caller Power unavailable"));
    if (signal?.aborted) abort();
    else signal?.addEventListener("abort", abort, { once: true });
    return () => signal?.removeEventListener("abort", abort);
  });
  scope_cleanups.set(context, () => removers.forEach((remove) => remove()));
}

/** Turn 完成后主动解除函数引用。 */
export function clear_turn_prompt_powers(context: SessionTurnContext): void {
  scope_cleanups.get(context)?.();
  scope_cleanups.delete(context);
  scopes.delete(context);
}

/** 把本轮 Power 编译为独立模型工具，并保留现有 Action 发现语义。 */
export function compose_prompt_power_tools(context: SessionTurnContext): Record<string, AgentTool> {
  return Object.fromEntries((scopes.get(context) ?? []).map((power) => [power.name, {
    description: `${power.description}\nCall without action to list Actions.`,
    input_schema: z.object({ action: z.string().optional(), args: z.json().optional() }),
    execute: async (payload: {
      /** 省略时查询动作描述。 */ action?: string;
      /** 目标 Action 的 JSON 参数。 */ args?: ModelJsonValue;
    }, site) => {
      if (!payload.action) return describe_prompt_powers([power])[0]!.actions;
      return await execute_prompt_power(power, payload.action, payload.args, {
        agent_id: site.agent_id, session_id: site.session_id,
        turn_id: context.session.turn_id, tool_call_id: site.tool_call_id!,
        call_id: randomUUID(), abort_signal: site.abort_signal ?? context.lifecycle.abort_signal,
      });
    },
  } satisfies AgentTool]));
}

/** 本轮指令动态组装，不写入 Session 冻结 system。 */
export function prompt_power_context_blocks(context: SessionTurnContext): SessionHookContextBlock[] {
  return (scopes.get(context) ?? []).map((power) => ({
    source_power: power.name,
    name: "caller_power",
    trust_level: "reference",
    content: `${power.description}${power.instruction ? `\n${power.instruction}` : ""}`,
  }));
}
