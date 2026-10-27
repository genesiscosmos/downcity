/** Unified Skill resource navigation and individual Skill detail, without Agent navigation. */
import { useEffect, useState } from "react";
import type { PowerMainviewComponentProps, PowerSidebarComponentProps } from "@downcity/city/power/react";
import type { SkillMainviewSnapshot, SkillMainviewReadResult } from "@/skill/types/SkillMainview.js";
import type { McpStatusResult } from "@/mcp/types/Mcp.js";
import { mcp_resource_detail as Mcp_resource_detail } from "@/mcp/renderer/McpResources.js";
import { collect_skills, find_skill_resource } from "./SkillResourceModel.js";

/** Load each resource family independently so one unavailable source does not hide the other. */
export function skill_resource_sidebar({ power, navigation, ui }: PowerSidebarComponentProps) {
  const { Sidebar, SidebarSection, SidebarItem, SidebarSubText, Callout, LoadingState } = ui.components;
  const [snapshot, set_snapshot] = useState<SkillMainviewSnapshot>();
  const [mcp, set_mcp] = useState<McpStatusResult>();
  const [skill_error, set_skill_error] = useState("");
  const [mcp_error, set_mcp_error] = useState("");
  useEffect(() => {
    let disposed = false;
    void power.invoke<SkillMainviewSnapshot>("skill.snapshot").then((next) => {
      if (!disposed) { set_snapshot(next); set_skill_error(""); }
    }).catch((reason) => { if (!disposed) set_skill_error(error_message(reason)); });
    void power.invoke<McpStatusResult>("skill.mcp.status").then((next) => {
      if (!disposed) { set_mcp(next); set_mcp_error(""); }
    }).catch((reason) => { if (!disposed) set_mcp_error(error_message(reason)); });
    return () => { disposed = true; };
  }, [power, ui.revision]);
  const resources = collect_skills(snapshot);
  useEffect(() => {
    if (navigation.route.resource_id) return;
    const first = resources[0];
    if (first) navigation.navigate({ resource_kind: "skill", resource_id: first.route_id });
    else if (snapshot && mcp?.servers[0]) navigation.navigate({ resource_kind: "mcp", resource_id: mcp.servers[0].id });
  }, [snapshot, mcp, navigation.route.resource_id, navigation.navigate]);
  return <Sidebar>
    <SidebarSection label="Skills">
      {!snapshot && !skill_error ? <LoadingState label="正在读取 Skills…" /> : null}
      {skill_error ? <Callout tone="danger">{skill_error}</Callout> : null}
      {resources.map((item) => <SidebarItem key={item.route_id} label={`${item.name} · ${item.source_label}`} active={navigation.route.resource_kind === "skill" && find_skill_resource(snapshot, String(navigation.route.resource_id))?.resource_id === item.resource_id} on_select={() => navigation.navigate({ resource_kind: "skill", resource_id: item.route_id })} />)}
      {snapshot && !resources.length ? <SidebarSubText>还没有 Skill</SidebarSubText> : null}
    </SidebarSection>
    <SidebarSection label="MCP">
      {!mcp && !mcp_error ? <LoadingState label="正在读取 MCP…" /> : null}
      {mcp_error ? <Callout tone="danger">{mcp_error}</Callout> : null}
      {mcp?.servers.map((server) => <SidebarItem key={server.id} label={server.id} trailing={server.tool_count} active={navigation.route.resource_kind === "mcp" && navigation.route.resource_id === server.id} on_select={() => navigation.navigate({ resource_kind: "mcp", resource_id: server.id })} />)}
      {mcp && !mcp.servers.length ? <SidebarSubText>还没有 MCP Server</SidebarSubText> : null}
    </SidebarSection>
  </Sidebar>;
}

/** Dispatch detail rendering by resource kind; each detail owns its own asynchronous reads. */
export function skill_resource_mainview(props: PowerMainviewComponentProps) {
  const { EmptyState, Page } = props.ui.components;
  const resource_id = typeof props.navigation.route.resource_id === "string" ? props.navigation.route.resource_id : "";
  if (!resource_id) return <Page><EmptyState title="选择一个 Skill 或 MCP Server" description="在左侧浏览资源；在 Agent 设置的 Skills 中分配资源。" /></Page>;
  if (props.navigation.route.resource_kind === "mcp") return <Mcp_resource_detail key={resource_id} {...props} server_id={resource_id} />;
  return <Skill_resource_detail key={resource_id} {...props} route_id={resource_id} />;
}

/** Individual Skill detail inputs. */
interface SkillResourceDetailProps extends PowerMainviewComponentProps {
  /** Source-owned Skill route selected in the resource sidebar. */
  readonly route_id: string;
}

/** Show installed Skill content together with its source and current Agent usage. */
function Skill_resource_detail({ power, ui, route_id }: SkillResourceDetailProps) {
  const { Page, Toolbar, Section, Group, Row, Markdown, LoadingState, Callout, EmptyState } = ui.components;
  const [snapshot, set_snapshot] = useState<SkillMainviewSnapshot>();
  const [content, set_content] = useState("");
  const [error, set_error] = useState("");
  const [loading, set_loading] = useState(true);
  useEffect(() => {
    let disposed = false;
    set_loading(true);
    set_error("");
    set_content("");
    void (async () => {
      const next = await power.invoke<SkillMainviewSnapshot>("skill.snapshot");
      if (disposed) return;
      set_snapshot(next);
      const selected = find_skill_resource(next, route_id);
      if (!selected) return;
      const result = await power.invoke<SkillMainviewReadResult>(selected.agent_id === null ? "skill.read_home" : "skill.read", selected.agent_id === null ? { skill_id: selected.skill_id } : { skill_id: selected.skill_id, agent_id: selected.agent_id });
      if (disposed) return;
      if (!result.success) throw new Error(result.error || "无法读取 Skill");
      set_content(result.content ?? "");
    })().catch((reason) => { if (!disposed) set_error(error_message(reason)); })
      .finally(() => { if (!disposed) set_loading(false); });
    return () => { disposed = true; };
  }, [power, route_id, ui.revision]);
  const item = find_skill_resource(snapshot, route_id);
  const users = snapshot?.agents.filter((agent) => agent.skills.some((skill) => skill.resource_id === item?.resource_id)) ?? [];
  return <Page>
    <Toolbar title={item?.name ?? "Skill"} description={item?.description} />
    {error ? <Callout tone="danger">{error}</Callout> : null}
    {item ? <Group>
      <Row label="来源" description={`${item.source_label} · ${item.source_path}`} />
      <Row label="使用此 Skill 的 Agent" description={users.map((agent) => agent.name).join("、") || "尚未分配"} />
    </Group> : null}
    {loading ? <LoadingState label="正在读取 Skill…" /> : !item ? <EmptyState title="Skill 已不存在" /> : <Section title="SKILL.md">{content ? <Markdown text={content} /> : !error ? <EmptyState title="Skill 内容为空" size="compact" /> : null}</Section>}
  </Page>;
}

/** Normalize gateway errors for display. */
export function error_message(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason);
}
