/**
 * 请求级 Power 的描述校验、Action 执行与 Turn 作用域。
 * 描述采用 JSON 快照；函数留在提供方，不进入 Session 的长期工具注册表。
 */
import { randomUUID, createHash } from "node:crypto";
import type { AgentSessionPromptInput } from "@/types/sdk/AgentSessionPrompt.js";
import { z } from "zod";
import type { AgentTool, ModelJsonValue, PromptPower, PromptPowerDescriptor, PromptPowerCallContext, SessionHookContextBlock } from "@downcity/type";
import type { SessionTurnContext } from "@/types/turn/SessionTurnContext.js";

const scopes = new WeakMap<SessionTurnContext, readonly PromptPower[]>();
const scope_cleanups = new WeakMap<SessionTurnContext, () => void>();
const name_schema = z.string().regex(/^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/);
const action_schema = z.object({
  description: z.string().max(16000).optional(),
  returns: z.string().max(16000).optional(),
  access: z.enum(["read", "write"]).optional(),
  examples: z.array(z.object({ title: z.string().max(256), description: z.string().max(16000).optional(), payload: z.json() }).strict()).max(32).optional(),
  input_schema: z.record(z.string(), z.unknown()),
  timeout_ms: z.number().int().min(1).max(300000).optional(),
}).strict();
const descriptor_schema = z.object({
  name: name_schema,
  title: z.string().max(256).optional(),
  description: z.string().max(16000),
  instruction: z.string().max(32000).optional(),
  actions: z.record(name_schema, action_schema),
}).strict();

/** 导出不可含函数的描述，并预编译 schema；任意非法描述在执行前拒绝。 */
export function describe_prompt_powers(powers: readonly PromptPowerDescriptor[]): PromptPowerDescriptor[] {
  if (powers.length > 32) throw new Error("Prompt supports at most 32 Powers");
  const names = new Set<string>();
  const descriptors = powers.map((power) => {
    const actions = Object.fromEntries(Object.entries(power.actions).map(([name, action]) => {
      const { description, returns, access, examples, input_schema, timeout_ms } = action;
      return [name, { description, returns, access, examples, input_schema, timeout_ms }];
    }));
    const descriptor = descriptor_schema.parse({
      name: power.name, title: power.title, description: power.description,
      instruction: power.instruction, actions,
    });
    if (names.has(descriptor.name)) throw new Error(`Duplicate Prompt Power: ${descriptor.name}`);
    names.add(descriptor.name);
    const entries = Object.values(descriptor.actions);
    if (!entries.length || entries.length > 128) throw new Error("Power requires between 1 and 128 Actions");
    for (const action of entries) {
      z.json().parse(action.input_schema);
      z.fromJSONSchema(action.input_schema);
    }
    return descriptor;
  });
  const encoded = JSON.stringify(descriptors);
  if (Buffer.byteLength(encoded) > 262144) throw new Error("Prompt Power descriptions exceed 256 KiB");
  return JSON.parse(encoded) as PromptPowerDescriptor[];
}

/** 能力请求的稳定摘要，不保存执行函数或重复保存附件内容。 */
export function prompt_power_fingerprint(input: AgentSessionPromptInput): string {
  return createHash("sha256").update(JSON.stringify({ query: input.query, powers: describe_prompt_powers(input.powers ?? []) })).digest("hex");
}

/** 快照描述及函数引用，避免调用方后续修改对象改变已接收的 Turn。 */
export function snapshot_prompt_powers(powers: readonly PromptPower[]): readonly PromptPower[] {
  return describe_prompt_powers(powers).map((descriptor, index) => ({
    ...descriptor,
    abort_signal: powers[index]!.abort_signal,
    actions: Object.fromEntries(Object.entries(descriptor.actions).map(([name, action]) => {
      const execute = powers[index]!.actions[name]?.execute;
      if (typeof execute !== "function") throw new Error(`Missing Action executor: ${descriptor.name}.${name}`);
      return [name, { ...action, execute }];
    })),
  }));
}

/** 校验并执行 Action，取消和超时即使遇到不响应信号的函数也能收口。 */
export async function execute_prompt_power(
  power: PromptPower,
  action_name: string,
  input: unknown,
  context: PromptPowerCallContext,
): Promise<ModelJsonValue> {
  const action = Object.hasOwn(power.actions, action_name) ? power.actions[action_name] : undefined;
  if (!action) throw new Error(`Unknown Action: ${power.name}.${action_name}`);
  const parsed = z.fromJSONSchema(action.input_schema).parse(input ?? {});
  const controller = new AbortController();
  const abort = () => controller.abort(context.abort_signal.reason ?? new Error("Power execution cancelled"));
  context.abort_signal.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(() => controller.abort(new Error("Power Action timed out")), action.timeout_ms ?? 60000);
  let reject_abort: () => void = () => {};
  try {
    if (context.abort_signal.aborted) abort();
    controller.signal.throwIfAborted();
    const cancelled = new Promise<never>((_, reject) => {
      reject_abort = () => reject(controller.signal.reason);
      controller.signal.addEventListener("abort", reject_abort, { once: true });
    });
    const result = await Promise.race([
      Promise.resolve().then(() => action.execute(parsed as ModelJsonValue, { ...context, abort_signal: controller.signal })),
      cancelled,
    ]);
    const output = z.json().parse(result);
    if (Buffer.byteLength(JSON.stringify(output)) > 1048576) throw new Error("Power result exceeds 1 MiB");
    return output;
  } finally {
    clearTimeout(timer);
    context.abort_signal.removeEventListener("abort", abort);
    controller.signal.removeEventListener("abort", reject_abort);
  }
}

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
