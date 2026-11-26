/**
 * Agent 通用变量的异步 Worker 端口。
 *
 * 与 Session 共用一个 Agent DB 租约、默认内存位置和持久化 provider。调用前完成
 * JSON 校验及编码，保证 Worker 不接收函数或特殊对象；未知提交使用原 operation receipt。
 */
import { randomUUID as random_uuid } from "node:crypto";
import type { AgentVariables, AgentVariableValue } from "@/types/agent/AgentVariables.js";
import type { AgentVariableMutation } from "@/types/store/AgentVariables.js";
import type { AgentSessionRuntimeLease } from "@/types/store/AgentSessionRuntime.js";
import { assert_agent_variable_key, encode_agent_variable } from "./AgentVariables.js";

/** 无独立数据库、缓存或 Session 外键的 Agent 变量集合。 */
export class AgentVariableStore implements AgentVariables {
  constructor(private readonly connection: () => Promise<AgentSessionRuntimeLease>) {}

  async get(key: string): Promise<AgentVariableValue | undefined> {
    assert_agent_variable_key(key);
    try {
      const result = await (await this.connection()).read<{ value: string | null }>({ command: "variable_get", key });
      return result.value === null ? undefined : JSON.parse(result.value);
    } catch (error) {
      // 新 Agent 尚未发生任何写入时没有数据库；读取缺失键保持无副作用。
      if (error instanceof Error && error.message === "session_storage_not_found") return undefined;
      throw error;
    }
  }

  async set(key: string, value: AgentVariableValue): Promise<void> {
    await this.mutate(key, "set", encode_agent_variable(value));
  }

  async delete(key: string): Promise<boolean> {
    return await this.mutate(key, "delete", null);
  }

  async compare_exchange(key: string, expected_value: AgentVariableValue | undefined, new_value: AgentVariableValue | undefined): Promise<boolean> {
    const expected = expected_value === undefined ? null : encode_agent_variable(expected_value);
    const value = new_value === undefined ? null : encode_agent_variable(new_value);
    return await this.mutate(key, "compare_exchange", value, expected);
  }

  /** 编码后的候选和 UUID 在派发前固定；事务与恢复使用完全相同的输入。 */
  private async mutate(key: string, mode: AgentVariableMutation["mode"], value: string | null, expected?: string | null): Promise<boolean> {
    assert_agent_variable_key(key);
    const input: AgentVariableMutation = { operation_id: random_uuid(), key, mode, value,
      ...(mode === "compare_exchange" ? { expected } : {}) };
    return await (await this.connection()).write<boolean>("variables", { command: "variable_mutate", input });
  }
}
