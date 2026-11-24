/** 应用公开对象图：单一接口契约生成代理路径、TypeScript 声明和帮助，不登记方法处理器。 */
import { createHash } from "node:crypto";
import { z } from "zod";
import { application_help_schema } from "./ApplicationHelp.js";
import type { ApplicationObject, ApplicationDescriptor, ApplicationCall, ApplicationPolicy } from "./types/Application.js";
import { PublicObjectBinding, public_methods, function_input, function_output } from "./PublicObjectBinding.js";

/** 宿主显式发布的应用对象集合。 */
export class PublicApplication {
  readonly descriptors: ApplicationDescriptor[];
  readonly revision: string;
  readonly declarations: string;

  constructor(private readonly objects: readonly ApplicationObject[], private readonly policy?: ApplicationPolicy) {
    const names = new Set<string>();
    this.descriptors = [];
    for (const object of objects) {
      if (!/^[a-z][a-z0-9_]*$/u.test(object.name) || ["help", "constructor", "prototype", "__proto__", "then"].includes(object.name) || names.has(object.name)) throw new Error("Invalid or duplicate public object name");
      names.add(object.name);
      public_methods(object.contract);
      describe_object(object.contract, object.name, this.descriptors);
    }
    this.revision = createHash("sha256").update(JSON.stringify(this.descriptors)).digest("hex").slice(0, 20);
    this.declarations = `declare const downcity: { ${objects.map(object => `${object.name}: ${contract_type(object.contract)}`).join("; ")} ; help(input?: ${contract_type(application_help_schema)}): Promise<any> };\ndeclare const state: Record<string, any>;\ndeclare const console: {log(...args: unknown[]): void; info(...args: unknown[]): void; warn(...args: unknown[]): void; error(...args: unknown[]): void};`;
  }

  /** 仅发布当前宿主确实挂载的接口；返回对象的方法也可发现。 */
  help(input: unknown = {}): unknown {
    const query = application_help_schema.parse(input);
    const matches = this.descriptors.filter(item => query.symbol ? item.symbol === query.symbol || item.symbol.startsWith(`${query.symbol}.`) || item.symbol.startsWith(`${query.symbol}()`) : !query.query || `${item.symbol} ${item.description}`.toLowerCase().includes(query.query.toLowerCase()));
    if (query.symbol && !matches.length) throw new Error("host_unavailable: public object or member is not installed");
    const cursor = query.cursor ?? 0;
    return { sdk_revision: this.revision, objects: this.objects.map(object => object.name), symbols: matches.slice(cursor, cursor + 12), next_cursor: cursor + 12 < matches.length ? cursor + 12 : null };
  }

  /** 绑定生命周期随执行而结束；执行器不缓存 caller 或领域实例。 */
  bind(call: ApplicationCall): PublicObjectBinding {
    return new PublicObjectBinding(this.objects, call, this.policy);
  }
}

/** 从接口遍历生成帮助，包括方法返回的公开对象。 */
function describe_object(contract: z.ZodObject, prefix: string, descriptors: ApplicationDescriptor[]): void {
  for (const [name, member] of Object.entries(contract.shape)) {
    const symbol = `${prefix}.${name}`;
    if (member instanceof z.ZodObject) describe_object(member, symbol, descriptors);
    else if (member instanceof z.ZodFunction) {
      const output = function_output(member);
      descriptors.push({ symbol, description: member.description ?? "Public application method.", input_type: contract_type(function_input(member)), output_type: contract_type(output) });
      if (output instanceof z.ZodObject && public_methods(output).length) describe_object(output, `${symbol}()`, descriptors);
    }
  }
}

/** 同一契约生成类型；函数输出可以是带方法的引用，普通数据保持 JSON。 */
function contract_type(schema: z.ZodType): string {
  if (schema instanceof z.ZodFunction) {
    const input = function_input(schema);
    const optional = input.safeParse({}).success ? "?" : "";
    return `(input${optional}: ${contract_type(input)}) => Promise<${contract_type(function_output(schema))}>`;
  }
  if (schema instanceof z.ZodObject && public_methods(schema).length) return `{ ${Object.entries(schema.shape).map(([key, value]) => `${JSON.stringify(key)}: ${contract_type(value as z.ZodType)}`).join("; ")} }`;
  return schema_type(z.toJSONSchema(schema, { io: "input" }) as Record<string, unknown>);
}

/** JSON schema 到声明文本；复杂度保持在公开数据协议内。 */
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
