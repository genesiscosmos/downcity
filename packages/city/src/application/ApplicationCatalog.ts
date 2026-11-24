/** 显式公开应用图：从同一运行时契约生成声明、client 绑定清单和分页帮助。 */
import { createHash } from "node:crypto";
import { z } from "zod";
import type { ApplicationModule, ApplicationExport, ApplicationDescriptor, ApplicationCall, ApplicationPolicy } from "./types/Application.js";
import { assert_public_execution_input } from "../power/core/PowerPrivateValues.js";

const forbidden_names = new Set(["constructor", "prototype", "__proto__", "then"]);

/** 宿主唯一的公开契约索引；不按任意对象属性分发。 */
export class ApplicationCatalog {
  private readonly methods = new Map<string, ApplicationExport>();
  readonly descriptors: ApplicationDescriptor[];
  readonly revision: string;
  readonly declarations: string;

  constructor(modules: readonly ApplicationModule[], private readonly policy?: ApplicationPolicy) {
    for (const module of modules) {
      if (!/^[a-z][a-z0-9_]*$/u.test(module.namespace) || (forbidden_names.has(module.namespace) || module.namespace === "help")) throw new Error("Invalid SDK namespace");
      if ([...this.methods.keys()].some(symbol => symbol.startsWith(`${module.namespace}.`))) throw new Error("Duplicate SDK namespace");
      for (const method of module.exports) {
        const parts = method.symbol.split(".");
        if (parts[0] !== module.namespace || parts.length < 2 || parts.some(part => !/^[a-z][a-z0-9_]*$/u.test(part) || forbidden_names.has(part))) throw new Error("Invalid public SDK symbol");
        if (this.methods.has(method.symbol)) throw new Error("Duplicate SDK symbol");
        // 公开图不允许方法与模块重叠，因此生成器不需要读取 getter 或内部对象。
        for (const existing of this.methods.keys()) if (existing.startsWith(`${method.symbol}.`) || method.symbol.startsWith(`${existing}.`)) throw new Error("Conflicting SDK symbol");
        this.methods.set(method.symbol, method);
      }
    }
    this.descriptors = [...this.methods.values()].map(method => ({ symbol: method.symbol, description: method.description, effect: method.effect,
      input_type: schema_type(z.toJSONSchema(method.input, { io: "input" }) as Record<string, unknown>),
      output_type: schema_type(z.toJSONSchema(method.output) as Record<string, unknown>),
    }));
    this.revision = createHash("sha256").update(JSON.stringify(this.descriptors)).digest("hex").slice(0, 20);
    this.declarations = generate_declarations(this.descriptors);
  }

  /** 返回有界、带 revision 的发现结果；缺失模块有独立错误语义。 */
  help(input: unknown = {}): unknown {
    const query = z.object({ query: z.string().max(200).optional(), symbol: z.string().max(200).optional(), cursor: z.number().int().min(0).optional() }).strict()
      .refine(value => !(value.query && value.symbol), "query and symbol are mutually exclusive").parse(input);
    const matches = this.descriptors.filter(item => query.symbol ? item.symbol === query.symbol || item.symbol.startsWith(`${query.symbol}.`) : !query.query || `${item.symbol} ${item.description}`.toLowerCase().includes(query.query.toLowerCase()));
    if (query.symbol && !matches.length) throw new Error("host_unavailable: public module or symbol is not installed");
    const cursor = query.cursor ?? 0;
    return { sdk_revision: this.revision, modules: [...new Set(this.descriptors.map(item => item.symbol.split(".")[0]))], symbols: matches.slice(cursor, cursor + 12), next_cursor: cursor + 12 < matches.length ? cursor + 12 : null };
  }

  /** 校验、逐次授权、审批、复查后进入共享业务实现；审批不持有领域锁。 */
  async invoke(symbol: string, raw_input: unknown, call: ApplicationCall): Promise<unknown> {
    call.signal.throwIfAborted();
    if (symbol === "help") return this.help(raw_input);
    const method = this.methods.get(symbol);
    if (!method) throw new Error("host_unavailable: unknown public SDK symbol");
    assert_public_execution_input({ power: "context", action: symbol, payload: raw_input }, call.context.call.interactions);
    const input = method.input.parse(raw_input);
    await method.authorize(input, call);
    await this.policy?.authorize(symbol, input, call);
    if (method.effect === "write") {
      const { context } = call;
      const approval = context.call.interactions.approval;
      const tool_call_id = context.call.tool_call_id;
      if (!approval || !tool_call_id || !context.turn?.id) throw new Error("approval_denied: trusted Tool Call and approval port required");
      const resume = call.pause_budget();
      let on_abort: (() => void) | undefined;
      try {
        call.signal.throwIfAborted();
        const cancelled = new Promise<never>((_resolve, reject) => {
          on_abort = () => reject(new Error("execution_cancelled: approval no longer belongs to an active cell"));
          call.signal.addEventListener("abort", on_abort, { once: true });
        });
        const decision = await Promise.race([approval.request({ turn_id: context.turn.id, tool_call_id, tool_name: `downcity.${symbol}`, source_type: "tool", description: method.description,
          payload: { operation: "tool", validated_input: input as never } }), cancelled]);
        if (!decision.approved) throw new Error("approval_denied: application call declined");
      } finally { if (on_abort) call.signal.removeEventListener("abort", on_abort); resume(); }
      call.signal.throwIfAborted();
      await method.authorize(input, call);
      await this.policy?.authorize(symbol, input, call);
    }
    call.signal.throwIfAborted();
    return method.output.parse(await method.invoke(input, call));
  }
}

/** JSON schema 到声明文本；不猜测类型系统以外的运行时行为。 */
function schema_type(schema: Record<string, unknown>): string {
  if (schema.const !== undefined) return JSON.stringify(schema.const);
  if (Array.isArray(schema.enum)) return schema.enum.map(value => JSON.stringify(value)).join(" | ");
  for (const key of ["anyOf", "oneOf"]) if (Array.isArray(schema[key])) return (schema[key] as Record<string, unknown>[]).map(schema_type).join(" | ");
  if (Array.isArray(schema.type)) return schema.type.map(type => schema_type({ ...schema, type })).join(" | ");
  switch (schema.type) {
    case "string": return "string";
    case "number": case "integer": return "number";
    case "boolean": return "boolean";
    case "null": return "null";
    case "array": return `Array<${schema_type((schema.items ?? {}) as Record<string, unknown>)}>`;
    case "object": {
      const required = new Set((schema.required ?? []) as string[]);
      const fields = Object.entries((schema.properties ?? {}) as Record<string, Record<string, unknown>>).map(([key, value]) => `${JSON.stringify(key)}${required.has(key) ? "" : "?"}: ${schema_type(value)}`);
      if (schema.additionalProperties && typeof schema.additionalProperties === "object") fields.push(`[key: string]: ${schema_type(schema.additionalProperties as Record<string, unknown>)}`);
      return `{ ${fields.join("; ")} }`;
    }
    default: return "unknown";
  }
}

/** 用显式导出路径生成嵌套 client 类型；添加方法无需改执行器。 */
function generate_declarations(descriptors: ApplicationDescriptor[]): string {
  const tree: Record<string, unknown> = Object.create(null);
  for (const descriptor of descriptors) {
    const parts = descriptor.symbol.split(".");
    let node = tree;
    for (const part of parts.slice(0, -1)) node = (node[part] ??= Object.create(null)) as Record<string, unknown>;
    node[parts.at(-1)!] = `(input${descriptor.input_type === "{  }" ? "?" : ""}: ${descriptor.input_type}) => Promise<${descriptor.output_type}>`;
  }
  const render = (node: Record<string, unknown>): string => `{ ${Object.entries(node).map(([key, value]) => `${JSON.stringify(key)}: ${typeof value === "string" ? value : render(value as Record<string, unknown>)}`).join("; ")} }`;
  return `declare const downcity: ${render(tree)} & { help(input?: {query?: string; symbol?: string; cursor?: number}): Promise<any> };\ndeclare const state: Record<string, any>;\ndeclare const console: {log(...args: unknown[]): void; info(...args: unknown[]): void; warn(...args: unknown[]): void; error(...args: unknown[]): void};`;
}
