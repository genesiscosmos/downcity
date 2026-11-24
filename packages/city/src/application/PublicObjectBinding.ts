/** 公开对象的执行期绑定；对象引用仅属于一个 cell，内部服务和原型始终留在宿主。 */
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { ApplicationCall, ApplicationObject, ApplicationPolicy, BoundPublicObject } from "./types/Application.js";
import { assert_public_execution_input } from "../power/core/PowerPrivateValues.js";

/** 只枚举 schema 中声明的公开成员，不读取实现的 getter 或原型。 */
export function public_methods(contract: z.ZodObject, prefix = ""): string[] {
  return Object.entries(contract.shape).flatMap(([name, value]) => {
    if (!/^[a-z][a-z0-9_]*$/u.test(name) || ["constructor", "prototype", "__proto__", "then"].includes(name)) throw new Error("Invalid public object member");
    const path = prefix ? `${prefix}.${name}` : name;
    return value instanceof z.ZodFunction ? [path] : value instanceof z.ZodObject ? public_methods(value, path) : [];
  });
}

/** 同一函数契约用于普通应用调用和跨引擎调用。 */
export function function_input(contract: z.ZodFunction): z.ZodType {
  const tuple = contract.def.input as z.ZodTuple;
  if (tuple.def.items.length !== 1) throw new Error("Public methods require one input object");
  return tuple.def.items[0] as z.ZodType;
}

/** 输出契约可以包含另一个公开对象，代理只持有不透明引用。 */
export function function_output(contract: z.ZodFunction): z.ZodType {
  return contract.def.output as z.ZodType;
}

/** 每次执行单独创建，所有代理和对象引用在 cell 终态后一起失效。 */
export class PublicObjectBinding {
  private readonly references = new Map<string, BoundPublicObject>();

  constructor(private readonly objects: readonly ApplicationObject[], private readonly call: ApplicationCall, private readonly policy?: ApplicationPolicy) {
    for (const object of objects) this.references.set(object.name, { object: object.bind(call), contract: object.contract, owner: object, path: object.name });
  }

  /** 公共入口在每次调用重新检查 caller、目标、信号和非秘密输入。 */
  async invoke(symbol: string, raw_input: unknown): Promise<unknown> {
    const { call } = this;
    call.signal.throwIfAborted();
    const [root, ...parts] = symbol.split(".");
    const reference = this.references.get(root!);
    if (!reference || !parts.length) throw new Error("permission_denied: unavailable public object reference");
    await reference.owner.authorize(call);
    let object = reference.object as Record<string, unknown>;
    let schema: z.ZodType = reference.contract;
    for (const part of parts.slice(0, -1)) {
      if (!(schema instanceof z.ZodObject) || !(schema.shape[part] instanceof z.ZodObject)) throw new Error("host_unavailable: unknown public member");
      schema = schema.shape[part];
      object = Object.getOwnPropertyDescriptor(object, part)?.value as Record<string, unknown>;
      if (!object || typeof object !== "object") throw new Error("host_unavailable: public object is unavailable");
    }
    const name = parts.at(-1)!;
    const method = schema instanceof z.ZodObject ? schema.shape[name] : undefined;
    if (!(method instanceof z.ZodFunction)) throw new Error("host_unavailable: unknown public method");
    assert_public_execution_input({ power: "context", action: symbol, payload: raw_input }, call.context.call.interactions);
    const input = function_input(method).parse(raw_input);
    const path = `${reference.path}.${parts.join(".")}`;
    await this.policy?.authorize(path, input, call);
    call.signal.throwIfAborted();
    const implementation = Object.getOwnPropertyDescriptor(object, name)?.value;
    if (typeof implementation !== "function") throw new Error("host_unavailable: public implementation is unavailable");
    const result = await implementation.call(object, input);
    // 已经开始的领域写入可能提交；取消后不得再颁发新引用。
    const output = function_output(method);
    if (output instanceof z.ZodObject && public_methods(output).length) {
      call.signal.throwIfAborted();
      const id = `ref_${randomUUID().replaceAll("-", "")}`;
      if (this.references.size >= 512) throw new Error("runtime_busy: public object reference budget exhausted");
      this.references.set(id, { object: result, contract: output, owner: reference.owner, path: `${path}()` });
      return { __downcity_object: id, methods: public_methods(output) };
    }
    return output.parse(result);
  }
}
