/**
 * city tool namespace 可见性策略。
 *
 * 关键点（中文）
 * - 可见性是 City 授予的，只能由 City 级配置表达，不能让 Agent 自己声明。
 * - 判定顺序固定：deny 优先，其次 Agent 显式 allow，最后落到默认集合。
 * - 敏感 namespace 不参与默认集合，必须被显式 allow。
 * - 配置由用户手工编辑，非法结构按缺省处理：配置错误不能让全部 Agent 失去工具。
 */

import type { CityNamespace } from "@/city/tool/namespaces/CityNamespace.js";

/** 单个 Agent 的 namespace 可见性覆盖。 */
interface AgentPolicy {
  /** 目标 Agent 标识。 */
  readonly agent_id: string;
  /** 显式允许的 namespace；null 表示继承默认集合。 */
  readonly allow: readonly string[] | null;
  /** 显式禁止的 namespace，优先级高于 allow。 */
  readonly deny: readonly string[];
}

/** 配置文本转为字符串数组；非数组或空值返回 null。 */
function read_string_list(input: unknown): string[] | null {
  if (!Array.isArray(input)) return null;
  const values = input
    .map((item) => (typeof item === "string" ? item.trim() : ""))
    .filter((item) => item.length > 0);
  return values.length > 0 ? [...new Set(values)] : null;
}

/** City 级 city tool 可见性策略。 */
export class CityToolPolicy {
  private constructor(
    /** 显式配置的默认可见 namespace；空数组表示未配置。 */
    private readonly defaults: readonly string[],
    /** 按 Agent 的覆盖项。 */
    private readonly agents: readonly AgentPolicy[],
  ) {}

  /** 从 City 级配置解析策略；结构非法时按缺省处理。 */
  static from_config(config: unknown): CityToolPolicy {
    const record = is_plain_object(config) ? config : {};
    const defaults_record = is_plain_object(record.defaults) ? record.defaults : {};
    return new CityToolPolicy(
      read_string_list(defaults_record.namespaces) ?? [],
      read_agent_policies(record.agents),
    );
  }

  /**
   * 解析当前 Agent 实际可见的 namespace。
   *
   * 关键点（中文）
   * - 未配置默认集合时，全部非敏感 namespace 默认可见。
   * - 未注册的名称在判定中被忽略，配置可以先于实现存在。
   */
  visible_for(
    agent_id: string,
    namespaces: readonly CityNamespace[],
  ): CityNamespace[] {
    const default_names = this.defaults.length > 0
      ? this.defaults
      : namespaces
        .filter((namespace) => !namespace.is_sensitive())
        .map((namespace) => namespace.namespace);
    const agent_policy = this.agents.find((entry) => entry.agent_id === agent_id);
    // allow 为 null 或不配置时继承默认集合；deny 永远优先。
    const effective_names = new Set(agent_policy?.allow ?? default_names);
    for (const denied of agent_policy?.deny ?? []) {
      effective_names.delete(denied);
    }
    return namespaces.filter((namespace) => effective_names.has(namespace.namespace));
  }
}

/** 判断未知值是否为普通对象。 */
function is_plain_object(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/** 解析 `[[config.agents]]` 数组。 */
function read_agent_policies(input: unknown): AgentPolicy[] {
  if (!Array.isArray(input)) return [];
  const policies: AgentPolicy[] = [];
  for (const item of input) {
    if (!is_plain_object(item)) continue;
    const agent_id = typeof item.agent_id === "string" ? item.agent_id.trim() : "";
    if (!agent_id) continue;
    policies.push({
      agent_id,
      allow: read_string_list(item.allow),
      deny: read_string_list(item.deny) ?? [],
    });
  }
  return policies;
}
