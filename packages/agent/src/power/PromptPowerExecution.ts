/**
 * 请求级 Power 的跨平台描述和执行协议实现。
 * 仅依赖 Web 标准与 Zod，Node、浏览器和扩展共用参数校验、取消及结果限制。
 */
import { z } from "zod";
import type { ModelJsonValue, PromptPower, PromptPowerDescriptor, PromptPowerCallContext } from "@downcity/type";

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

/** 导出不可含函数的描述；非法或无法编译的 schema 在执行前拒绝。 */
export function describe_prompt_powers(powers: readonly PromptPowerDescriptor[]): PromptPowerDescriptor[] {
  if (powers.length > 32) throw new Error("Prompt supports at most 32 Powers");
  const names = new Set<string>();
  const descriptors = powers.map((power) => {
    const actions = Object.fromEntries(Object.entries(power.actions).map(([name, action]) => {
      const { description, returns, access, examples, input_schema, timeout_ms } = action;
      return [name, { description, returns, access, examples, input_schema, timeout_ms }];
    }));
    const descriptor = descriptor_schema.parse({ name: power.name, title: power.title, description: power.description, instruction: power.instruction, actions });
    if (names.has(descriptor.name)) throw new Error(`Duplicate Prompt Power: ${descriptor.name}`);
    names.add(descriptor.name);
    const entries = Object.values(descriptor.actions);
    if (!entries.length || entries.length > 128) throw new Error("Power requires between 1 and 128 Actions");
    for (const action of entries) { z.json().parse(action.input_schema); z.fromJSONSchema(action.input_schema); }
    return descriptor;
  });
  const encoded = JSON.stringify(descriptors);
  if (new TextEncoder().encode(encoded).byteLength > 262144) throw new Error("Prompt Power descriptions exceed 256 KiB");
  return JSON.parse(encoded) as PromptPowerDescriptor[];
}

/** 描述与函数引用按请求快照，提供方资源生命周期保持不变。 */
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

/** 协作取消之外，Promise 竞争也保证不响应信号的函数不会阻塞 Turn 收口。 */
export async function execute_prompt_power(power: PromptPower, action_name: string, input: unknown, context: PromptPowerCallContext): Promise<ModelJsonValue> {
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
      Promise.resolve().then(() => action.execute(parsed as ModelJsonValue, { ...context, abort_signal: controller.signal })), cancelled,
    ]);
    const output = z.json().parse(result);
    if (new TextEncoder().encode(JSON.stringify(output)).byteLength > 1048576) throw new Error("Power result exceeds 1 MiB");
    return output;
  } finally {
    clearTimeout(timer);
    context.abort_signal.removeEventListener("abort", abort);
    controller.signal.removeEventListener("abort", reject_abort);
  }
}
