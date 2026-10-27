/** Agent Skills tab: assign global Skills and MCP servers, and read installed Skill content. */
import { useEffect, useRef, useState } from "react";
import type { PowerAgentConfigComponentProps } from "@downcity/city/power/react";
import type { PowerJsonObject } from "@downcity/city/power";
import type { SkillMainviewSnapshot, SkillMainviewMutationResult, SkillMainviewReadResult, SkillMainviewItem } from "@/skill/types/SkillMainview.js";
import { error_message } from "./SkillResources.js";

/** Installed Skill reader with state retained while the same resource refreshes. */
interface SkillReaderProps extends PowerAgentConfigComponentProps {
  /** Exact installed directory ID to read within the current Agent. */
  readonly skill_id: string;
  /** Close the current reader without changing installed resources. */
  readonly on_close: () => void;
}

/** Refresh content in place; failures retain the last successful body and expose an error. */
function Skill_reader({ agent_id, skill_id, power, ui, on_close }: SkillReaderProps) {
  const { Section, Button, Markdown, Callout, LoadingState, EmptyState } = ui.components;
  const [content, set_content] = useState<string>();
  const [error, set_error] = useState("");
  const [reading, set_reading] = useState(true);
  useEffect(() => {
    let disposed = false;
    set_reading(true);
    void power.invoke<SkillMainviewReadResult>("skill.read", { agent_id, skill_id }).then((result) => {
      if (!result.success) throw new Error(result.error || "读取失败");
      if (!disposed) { set_content(result.content ?? ""); set_error(""); }
    }).catch((reason) => { if (!disposed) set_error(error_message(reason)); })
      .finally(() => { if (!disposed) set_reading(false); });
    return () => { disposed = true; };
  }, [agent_id, skill_id, power, ui.revision]);
  return <Section title={`${skill_id} · SKILL.md`} action={<Button on_click={on_close}>关闭</Button>}>
    {error ? <Callout tone="danger">{error}</Callout> : null}
    {content !== undefined ? content ? <Markdown text={content} /> : <EmptyState title="Skill 内容为空" size="compact" /> : reading ? <LoadingState label="正在读取 Skill…" /> : null}
  </Section>;
}

/** Reset editor state only when the host selects a different Agent. */
export function skill_agent_config(props: PowerAgentConfigComponentProps) {
  return <Skill_agent_editor key={props.agent_id} {...props} />;
}

/** Resource assignment editor scoped exclusively to the Agent provided by the host. */
function Skill_agent_editor({ agent_id, power, ui }: PowerAgentConfigComponentProps) {
  const { Page, Toolbar, Section, Group, Row, Button, Switch, Input, Callout, LoadingState, EmptyState } = ui.components;
  const [snapshot, set_snapshot] = useState<SkillMainviewSnapshot>();
  const [filter, set_filter] = useState("");
  const [busy, set_busy] = useState(false);
  const busy_ref = useRef(false);
  const mounted_ref = useRef(true);
  useEffect(() => {
    mounted_ref.current = true;
    return () => { mounted_ref.current = false; };
  }, []);
  const [error, set_error] = useState("");
  const [selected_id, set_selected_id] = useState("");
  const selected_skill = snapshot?.agents.find((item) => item.agent_id === agent_id)?.skills.find((item) => item.id === selected_id);
  useEffect(() => {
    let disposed = false;
    void power.invoke<SkillMainviewSnapshot>("skill.snapshot").then((next) => {
      if (!disposed) { set_snapshot(next); set_error(""); }
    }).catch((reason) => { if (!disposed) set_error(error_message(reason)); });
    return () => { disposed = true; };
  }, [power, agent_id, ui.revision]);
  useEffect(() => {
    if (snapshot && selected_id && !selected_skill) set_selected_id("");
  }, [snapshot, selected_id, selected_skill]);

  const mutate = async (action_id: string, payload: PowerJsonObject) => {
    if (busy_ref.current || !mounted_ref.current) return;
    busy_ref.current = true;
    set_busy(true);
    set_error("");
    try {
      const result = await power.invoke<SkillMainviewMutationResult>(action_id, { ...payload, agent_id });
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
  const remove_skill = async (item: SkillMainviewItem) => {
    if (!await ui.confirm({ title: `移除 ${item.name}？`, description: item.is_link ? "移除该 Agent 的关联。" : "从该 Agent 目录永久删除此 Skill。", action: "移除", destructive: true })) return;
    await mutate("skill.remove", { skill_id: item.id });
  };
  const agent = snapshot?.agents.find((item) => item.agent_id === agent_id);
  const matches = (name: string, description = "") => `${name} ${description}`.toLowerCase().includes(filter.trim().toLowerCase());
  if (!snapshot) return <Page>{error ? <Callout tone="danger">{error}</Callout> : <LoadingState label="正在读取 Skills…" />}</Page>;
  if (!agent) return <Page><EmptyState title="Agent 已不存在" /></Page>;
  return <Page>
    <Toolbar title="Skills" description="为当前 Agent 分配 Skills 和 MCP Server。" />
    {error ? <Callout tone="danger">{error}</Callout> : null}
    <Input value={filter} placeholder="搜索 Skills 和 MCP" on_value_change={set_filter} />
    <Section title="已安装 Skills">
      {!agent.skills.length ? <EmptyState title="还没有 Skill" size="compact" /> : <Group>{agent.skills.filter((item) => matches(item.name, `${item.id} ${item.description}`)).map((item) => <Row key={item.id} label={item.name} description={item.description || item.id} on_click={() => set_selected_id(item.id)} trailing={<Button disabled={busy} variant="destructive" on_click={() => void remove_skill(item)}>移除</Button>} />)}</Group>}
    </Section>
    {selected_skill ? <Skill_reader key={selected_skill.resource_id} agent_id={agent_id} skill_id={selected_skill.id} power={power} ui={ui} on_close={() => set_selected_id("")} /> : null}
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
