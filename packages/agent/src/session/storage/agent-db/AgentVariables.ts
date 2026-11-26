/**
 * Agent 通用变量的 JSON 边界与同库原子事务。
 *
 * 仅保存宿主提供的数据，不识别 Session 指针或其他业务键。写操作使用现有
 * operation receipt，CAS 在单写事务内比较，读取返回独立反序列化副本。
 */
import { isDeepStrictEqual as is_deep_strict_equal } from "node:util";
import type { AgentVariableValue } from "@/types/agent/AgentVariables.js";
import type { AgentVariableMutation } from "@/types/store/AgentVariables.js";
import type { AgentSessionDatabase } from "./AgentSessionDatabase.js";

/** 拒绝不能无损表达为 JSON 的值；键保留宿主原始语义。 */
export function encode_agent_variable(value: AgentVariableValue): string {
  const ancestors = new Set<object>();
  const validate = (item: unknown): void => {
    if (item === null || typeof item === "string" || typeof item === "boolean") return;
    if (typeof item === "number" && Number.isFinite(item)) return;
    if (typeof item !== "object" || ancestors.has(item)) throw new Error("agent_variable_value_invalid");
    if (!Array.isArray(item) && Object.getPrototypeOf(item) !== Object.prototype && Object.getPrototypeOf(item) !== null) {
      throw new Error("agent_variable_value_invalid");
    }
    ancestors.add(item);
    if (Array.isArray(item)) {
      if (Reflect.ownKeys(item).length !== item.length + 1) throw new Error("agent_variable_value_invalid");
      for (let index = 0; index < item.length; index += 1) {
        const descriptor = Object.getOwnPropertyDescriptor(item, String(index));
        if (!descriptor || !descriptor.enumerable || !("value" in descriptor)) throw new Error("agent_variable_value_invalid");
        validate(descriptor.value);
      }
    } else {
      for (const key of Reflect.ownKeys(item)) {
        if (typeof key !== "string") throw new Error("agent_variable_value_invalid");
        const descriptor = Object.getOwnPropertyDescriptor(item, key)!;
        if (!descriptor.enumerable || !("value" in descriptor)) throw new Error("agent_variable_value_invalid");
        validate(descriptor.value);
      }
    }
    ancestors.delete(item);
  };
  validate(value);
  return JSON.stringify(value);
}

/** 非空键不做 trim 或别名映射，避免不同宿主键被隐式合并。 */
export function assert_agent_variable_key(key: string): void {
  if (typeof key !== "string" || !key.trim()) throw new Error("agent_variable_key_invalid");
}

/** 固定命令使用字符串封装缺失语义，避免 Worker JSON 丢失 undefined。 */
export function read_agent_variable(owner: AgentSessionDatabase, key: string): { value: string | null } {
  assert_agent_variable_key(key);
  return owner.read(database => {
    const row = database.prepare("SELECT value FROM agent_variables WHERE key = ?").get(key);
    return { value: row ? String(row.value) : null };
  });
}

/** CAS 比较已解码 JSON，因此对象字段顺序不影响相等性。 */
export function mutate_agent_variable(owner: AgentSessionDatabase, input: AgentVariableMutation): boolean {
  assert_agent_variable_key(input.key);
  return owner.write(input.operation_id, { command: "variable_mutate", ...input }, database => {
    const row = database.prepare("SELECT value FROM agent_variables WHERE key = ?").get(input.key);
    if (input.mode === "compare_exchange") {
      const current = row ? JSON.parse(String(row.value)) : undefined;
      if (input.expected === undefined) throw new Error("agent_variable_value_invalid");
      const expected = input.expected === null ? undefined : JSON.parse(input.expected);
      if (!is_deep_strict_equal(current, expected)) return false;
    }
    if (input.value === null) {
      const removed = database.prepare("DELETE FROM agent_variables WHERE key = ?").run(input.key);
      return input.mode === "compare_exchange" || Number(removed.changes) > 0;
    }
    const encoded = encode_agent_variable(JSON.parse(input.value));
    database.prepare("INSERT INTO agent_variables(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
      .run(input.key, encoded);
    return true;
  });
}
