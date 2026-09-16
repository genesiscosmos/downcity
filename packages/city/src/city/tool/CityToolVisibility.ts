/**
 * city tool namespace 可见性判定。
 *
 * 关键点（中文）
 * - 可见性是 City 授予的，只能由 City 级配置表达，不能让 Agent 自己声明。
 * - 判定顺序固定：deny 优先，其次 Agent 显式 allow，最后落到默认集合。
 * - 敏感 namespace 不参与默认集合，必须被显式 allow。
 */

import type {
  CityToolAgentPolicy,
  CityToolNamespaceProvider,
  CityToolPolicy,
} from "@/city/types/CityTool.js";

/** 配置文本转为字符串数组；非数组或空值返回 null。 */
function read_string_list(input: unknown): string[] | null {
  if (!Array.isArray(input)) return null;
  const values = input
    .map((item) => (typeof item === "string" ? item.trim() : ""))
    .filter((item) => item.length > 0);
  return values.length > 0 ? [...new Set(values)] : null;
}

/** 判断一个 namespace 是否按敏感处理。 */
function is_sensitive_namespace(provider: CityToolNamespaceProvider): boolean {
  return provider.actions.some((action) => action.sensitivity === "sensitive");
}

/**
 * 解析 City 级 city tool 配置。
 *
 * 关键点（中文）
 * - 配置来自 `plugins/city/config.toml` 的 `config` 表，内容完全由用户编辑。
 * - 非法结构按缺省处理，配置错误不能让全部 Agent 失去工具。
 */
export function resolve_city_tool_policy(config: unknown): CityToolPolicy {
  const record = config && typeof config === "object" && !Array.isArray(config)
    ? config as Record<string, unknown>
    : {};
  const defaults_record = record.defaults && typeof record.defaults === "object" && !Array.isArray(record.defaults)
    ? record.defaults as Record<string, unknown>
    : {};
  const agents_input = Array.isArray(record.agents) ? record.agents : [];
  const agents: CityToolAgentPolicy[] = [];
  for (const item of agents_input) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const entry = item as Record<string, unknown>;
    const agent_id = typeof entry.agent_id === "string" ? entry.agent_id.trim() : "";
    if (!agent_id) continue;
    agents.push({
      agent_id,
      allow: read_string_list(entry.allow),
      deny: read_string_list(entry.deny) ?? [],
    });
  }
  return {
    defaults: read_string_list(defaults_record.namespaces) ?? [],
    agents,
  };
}

/**
 * 解析当前 Agent 实际可见的 namespace provider。
 *
 * 关键点（中文）
 * - 未配置默认集合时，全部非敏感 namespace 默认可见。
 * - 未注册的名称在判定中被忽略，配置可以先于实现存在。
 */
export function resolve_visible_namespaces(input: {
  /** City 级可见性策略。 */
  policy: CityToolPolicy;
  /** 当前 Agent 标识。 */
  agent_id: string;
  /** 当前全部已注册 provider。 */
  providers: readonly CityToolNamespaceProvider[];
}): readonly CityToolNamespaceProvider[] {
  const default_names = input.policy.defaults.length > 0
    ? input.policy.defaults
    : input.providers
      .filter((provider) => !is_sensitive_namespace(provider))
      .map((provider) => provider.namespace);
  const agent_policy = input.policy.agents
    .find((entry) => entry.agent_id === input.agent_id);
  // allow 为 null 或不配置时继承默认集合；deny 永远优先。
  const effective_names = new Set(agent_policy?.allow ?? default_names);
  for (const denied of agent_policy?.deny ?? []) {
    effective_names.delete(denied);
  }
  return input.providers.filter((provider) => effective_names.has(provider.namespace));
}
