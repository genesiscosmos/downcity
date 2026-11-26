/** Agent Skills 页签：分配全局 Skill 与 MCP，通过宿主独立视图打开已安装 Skill。 */
import { useEffect, useRef, useState } from "react";
import type { PowerAgentConfigComponentProps } from "@downcity/city/power/react";
import type { PowerJsonObject } from "@downcity/city/power";
import type { SkillPageSnapshot, SkillPageMutationResult, SkillPageItem } from "@/skill/types/SkillPage.js";
import { error_message } from "./SkillResources.js";
/** Reset editor state only when the host selects a different Agent. */
export function skill_agent_config(props: PowerAgentConfigComponentProps) {
  return <Skill_agent_editor key={props.agent_id} {...props} />;
}

/** Resource assignment editor scoped exclusively to the Agent provided by the host. */
function Skill_agent_editor({ agent_id, power, ui }: PowerAgentConfigComponentProps) {
  const { Page, Section, Group, Row, Button, Switch, Input, Callout, LoadingState, EmptyState } = ui.components;
  const [snapshot, set_snapshot] = useState<SkillPageSnapshot>();
  const [filter, set_filter] = useState("");
  const [busy, set_busy] = useState(false);
  const busy_ref = useRef(false);
  const mounted_ref = useRef(true);
  useEffect(() => {
    mounted_ref.current = true;
    return () => { mounted_ref.current = false; };
  }, []);
  const [error, set_error] = useState("");
  useEffect(() => {
    let disposed = false;
    void power.invoke<SkillPageSnapshot>("skill.snapshot").then((next) => {
      if (!disposed) { set_snapshot(next); set_error(""); }
    }).catch((reason) => { if (!disposed) set_error(error_message(reason)); });
    return () => { disposed = true; };
  }, [power, agent_id, ui.revision]);

  const mutate = async (action_id: string, payload: PowerJsonObject) => {
    if (busy_ref.current || !mounted_ref.current) return;
    busy_ref.current = true;
    set_busy(true);
    set_error("");
    try {
      const result = await power.invoke<SkillPageMutationResult>(action_id, { ...payload, agent_id });
      if (!result.operation_success) throw new Error(result.error || "操作失败");
      if (mounted_ref.current) set_snapshot(result);
      ui.invalidate();
    } catch (reason) {
      if (mounted_ref.current) set_error(error_message(reason));
    } finally {
      busy_ref.current = false;
      if (mounted_ref.current) set_busy(false);
    }
  };
  const remove_skill = async (item: SkillPageItem) => {
    if (!await ui.confirm({ title: `移除 ${item.name}？`, description: item.is_link ? "移除该 Agent 的关联。" : "从该 Agent 目录永久删除此 Skill。", action: "移除", destructive: true })) return;
    await mutate("skill.remove", { skill_id: item.id });
  };
  const agent = snapshot?.agents.find((item) => item.agent_id === agent_id);
  const matches = (name: string, description = "") => `${name} ${description}`.toLowerCase().includes(filter.trim().toLowerCase());
  if (!snapshot) return <Page>{error ? <Callout tone="danger">{error}</Callout> : <LoadingState label="正在读取 Skills…" />}</Page>;
  if (!agent) return <Page><EmptyState title="Agent 已不存在" /></Page>;
  return <Page>
    {error ? <Callout tone="danger">{error}</Callout> : null}
    <Input value={filter} placeholder="搜索 Skills 和 MCP" on_value_change={set_filter} />
    <Section title="已安装 Skills">
      {!agent.skills.length ? <EmptyState title="还没有 Skill" size="compact" /> : <Group>{agent.skills.filter((item) => matches(item.name, `${item.id} ${item.description}`)).map((item) => <Row key={item.id} label={item.name} description={item.description || item.id} on_click={() => ui.open_view({ view_id: "skill_detail", resource_key: JSON.stringify([agent_id, item.id]), title: item.name || item.id, input: { agent_id, skill_id: item.id, skill_name: item.name, skill_description: item.description } })} trailing={<Button disabled={busy} variant="destructive" on_click={() => void remove_skill(item)}>移除</Button>} />)}</Group>}
    </Section>
    <Section title="全局 Skills">
      {!snapshot.available.length ? <EmptyState title="全局目录里没有 Skill" description="把 Skill 放进 ~/.agents/skills 后即可分配。" size="compact" /> : <Group>{snapshot.available.filter((item) => matches(item.name, `${item.id} ${item.description}`)).map((item) => {
        const installed = agent.skills.some((skill) => skill.resource_id === item.resource_id);
        const collision = agent.skills.some((skill) => skill.id === item.id && skill.resource_id !== item.resource_id);
        return <Row key={item.id} label={item.name} description={collision ? `同名目录 ${item.id} 已被独立 Skill 占用` : item.description || item.id} trailing={<Button disabled={busy || installed || collision} on_click={() => void mutate("skill.link", { skill_id: item.id })}>{installed ? "已关联" : collision ? "同名目录已占用" : "添加"}</Button>} />;
      })}</Group>}
    </Section>
    <Section title="MCP">
      {!snapshot.mcp_servers.length && !agent.mcp_server_ids.length ? <EmptyState title="还没有 MCP Server" size="compact" /> : <Group>{snapshot.mcp_servers.filter((server) => matches(server.id)).map((server) => <Row key={server.id} label={server.id} description={`${server.state} · ${server.tool_count} 个工具`} trailing={<Switch aria_label={`为当前 Agent 分配 ${server.id}`} checked={agent.mcp_server_ids.includes(server.id)} disabled={busy} on_checked_change={(assigned) => void mutate(assigned ? "skill.mcp.assign" : "skill.mcp.unassign", { server_id: server.id })} />} />)}
        {agent.mcp_server_ids.filter((id) => !snapshot.mcp_servers.some((server) => server.id === id) && matches(id)).map((id) => <Row key={id} label={id} description="全局定义已删除" trailing={<Button disabled={busy} on_click={() => void mutate("skill.mcp.unassign", { server_id: id })}>移除分配</Button>} />)}
      </Group>}
    </Section>
  </Page>;
}
