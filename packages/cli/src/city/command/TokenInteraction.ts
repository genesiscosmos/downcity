/** City Token 交互输入；数据库操作前收集完整配置，取消不会产生写入。 */
import prompts from "@/city/tui/Prompts.js";
import { with_cli_local_data } from "@/city/runtime/LocalData.js";
import type { CityTokenConfig, CityTokenSummary } from "@downcity/city/local";
import type { CityTokenCommandOptions } from "@/city/types/auth/CityTokenCommand.js";

/** 只有真实终端允许等待用户输入，脚本参数缺失时直接报错。 */
export function require_interactive(): void {
  if (!process.stdin.isTTY || !process.stdout.isTTY) throw new Error("Missing arguments: use an interactive terminal or provide complete options");
}

/** 读取单项回答，Escape 等取消作为明确终止处理。 */
export async function token_question(question: Parameters<typeof prompts>[0]): Promise<unknown> {
  require_interactive();
  const answer = await prompts(question);
  if (!Object.hasOwn(answer, "value")) throw new Error("Token operation cancelled");
  return answer.value;
}

/** 指定记录 ID 或在摘要列表选择，不加载明文。 */
export async function select_token(token_id?: string): Promise<CityTokenSummary> {
  if (token_id) return with_cli_local_data((data) => data.city_tokens.get(token_id));
  const tokens = with_cli_local_data((data) => data.city_tokens.list());
  if (!tokens.length) throw new Error("No City Tokens; run city token create");
  const selected = await token_question({ type: "select", name: "value", message: "选择 City Token", choices: tokens.map((item) => ({ title: item.name, description: `${item.token_id} · ${item.all_agents ? "全部 Agents（含未来）" : item.agent_ids.join(", ")} · ${item.expires_at ?? "永不过期"}`, value: item.token_id })) });
  return tokens.find((item) => item.token_id === selected)!;
}

/** 参数预填、交互补齐；update 只在明确提供字段时修改对应设置。 */
export async function collect_token_config(options: CityTokenCommandOptions, previous?: CityTokenSummary): Promise<CityTokenConfig> {
  if (options.allAgents && options.agents !== undefined) throw new Error("--all-agents and --agents are mutually exclusive");
  if (options.neverExpires && options.expiresAt !== undefined) throw new Error("--never-expires and --expires-at are mutually exclusive");
  const interactive_edit = previous && !options.name && options.agents === undefined && !options.allAgents && options.expiresAt === undefined && !options.neverExpires;
  const name = options.name ?? (!interactive_edit ? previous?.name : undefined) ?? String(await token_question({ type: "text", name: "value", message: "Token 名称", initial: previous?.name, validate: (value) => String(value).trim() ? true : "名称不能为空" }));
  let all_agents = options.allAgents;
  let agent_ids = options.agents?.split(",").map((id) => id.trim()).filter(Boolean);
  if (all_agents === undefined && agent_ids === undefined && previous && !interactive_edit) {
    all_agents = previous.all_agents; agent_ids = previous.agent_ids;
  }
  if (all_agents === undefined && agent_ids === undefined) {
    all_agents = await token_question({ type: "select", name: "value", message: "授权范围", choices: [{ title: "指定 Agents", value: false }, { title: "全部 Agents（包含未来创建的 Agent）", value: true }] }) === true;
    if (!all_agents) {
      const agents = with_cli_local_data((data) => data.agents.list());
      const known = new Set(agents.map((agent) => agent.agent_id));
      agent_ids = await token_question({ type: "multiselect", name: "value", message: "选择允许访问的 Agents", choices: [
        ...agents.map((agent) => ({ title: agent.name || agent.agent_id, description: `${agent.agent_id} · ${agent.description ?? ""}`, value: agent.agent_id })),
        ...(previous?.agent_ids.filter((id) => !known.has(id)).map((id) => ({ title: `${id}（已不存在）`, value: id })) ?? []),
      ], initial: previous?.agent_ids ?? [] }) as string[];
    }
  }
  if (!all_agents && !agent_ids?.length) throw new Error("必须至少选择一个 Agent");
  const registered = with_cli_local_data((data) => new Set(data.agents.list().map((agent) => agent.agent_id)));
  for (const id of agent_ids ?? []) if (!registered.has(id) && !previous?.agent_ids.includes(id)) throw new Error(`Agent not found: ${id}`);
  let expires_at: string | null | undefined = options.neverExpires ? null : options.expiresAt;
  if (expires_at === undefined && previous && !interactive_edit) expires_at = previous.expires_at;
  if (expires_at === undefined) {
    const days = await token_question({ type: "select", name: "value", message: "有效期", choices: [{ title: "30 天", value: 30 }, { title: "90 天", value: 90 }, { title: "永不过期", value: 0 }, { title: "自定义 ISO8601 日期", value: -1 }] });
    expires_at = days === -1 ? String(await token_question({ type: "text", name: "value", message: "过期时间（含时区）" })) : days === 0 ? null : new Date(Date.now() + Number(days) * 86400000).toISOString();
  }
  if (expires_at !== null && (!Number.isFinite(Date.parse(expires_at)) || Date.parse(expires_at) <= Date.now())) throw new Error("Expiry must be a future ISO8601 date");
  return { name, all_agents: all_agents === true, agent_ids: all_agents ? [] : agent_ids!, expires_at };
}

/** 在写入前展示授权范围并由交互用户确认。 */
export async function confirm_token_config(config: CityTokenConfig): Promise<void> {
  const accepted = await token_question({ type: "confirm", name: "value", message: `确认：${config.name}；${config.all_agents ? "全部现有和未来 Agents" : config.agent_ids.join(", ")}；到期 ${config.expires_at ?? "永不"}`, initial: false });
  if (!accepted) throw new Error("Token operation cancelled");
}
