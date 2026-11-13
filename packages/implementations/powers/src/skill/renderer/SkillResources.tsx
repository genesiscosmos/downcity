/**
 * Skill Power 资源浏览界面。
 * Sidebar 用胶囊切换 Skills / MCP，统一展示资源名称，按类型保留搜索和选择。
 * Mainview 展示选中资源，Skill 正文优先，来源与 Agent 使用信息按需展开。
 */
import { useEffect, useState } from "react";
import type { PowerMainviewComponentProps, PowerSidebarComponentProps } from "@downcity/city/power/react";
import type { SkillMainviewSnapshot, SkillMainviewReadResult } from "@/skill/types/SkillMainview.js";
import type { McpStatusResult } from "@/mcp/types/Mcp.js";
import { mcp_resource_detail as Mcp_resource_detail } from "@/mcp/renderer/McpResources.js";
import { collect_skills, find_skill_resource } from "./SkillResourceModel.js";
import { Skill_document } from "./SkillDocument.js";

/** Load each resource family independently so one unavailable source does not hide the other. */
export function skill_resource_sidebar({ power, navigation, ui }: PowerSidebarComponentProps) {
  const { Sidebar, SidebarSection, SidebarItem, EmptyState, Tabs, Input, StatusDot, Callout, LoadingState } = ui.components;
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
  const { route, navigate } = navigation;
  const resource_kind = route.resource_kind === "mcp" ? "mcp" : "skill";
  const resource_id = typeof route.resource_id === "string" ? route.resource_id : "";
  const stored_query = route[`${resource_kind}_query`];
  const query = typeof stored_query === "string" ? stored_query : "";
  const normalized_query = query.trim().toLowerCase();
  const resources = collect_skills(snapshot).filter((item) => `${item.name} ${item.skill_id} ${item.description}`.toLowerCase().includes(normalized_query));
  const servers = (mcp?.servers ?? []).filter((server) => server.id.toLowerCase().includes(normalized_query)).slice().sort((left, right) => left.id.localeCompare(right.id));
  const selected_skill = find_skill_resource(snapshot, resource_id);
  const select_resource = (selected_id: string) => navigate({
    ...route, resource_kind, resource_id: selected_id, [`${resource_kind}_resource_id`]: selected_id,
  });
  const switch_kind = (value: string) => {
    const next_kind = value === "mcp" ? "mcp" : "skill";
    if (next_kind === resource_kind) return;
    const stored_id = route[`${next_kind}_resource_id`];
    navigate({
      ...route,
      [`${resource_kind}_resource_id`]: resource_id,
      resource_kind: next_kind,
      resource_id: typeof stored_id === "string" ? stored_id : "",
    });
  };
  return <Sidebar
    actions={<Tabs variant="segmented" label="资源类型" value={resource_kind} items={[{ value: "skill", label: "Skills" }, { value: "mcp", label: "MCP" }]} on_value_change={switch_kind} />}
    toolbar={<Input type="search" fill value={query} placeholder={resource_kind === "skill" ? "搜索 Skills…" : "搜索 MCP…"} on_value_change={(value) => navigate({ ...route, [`${resource_kind}_query`]: value })} />}
  >
    <SidebarSection spacing="comfortable">
      {resource_kind === "skill" ? <>
        {!snapshot && !skill_error ? <LoadingState label="正在读取 Skills…" /> : null}
        {skill_error ? <Callout tone="danger">{skill_error}</Callout> : null}
        {resources.map((item) => <SidebarItem key={item.route_id} resource_kind="skill" label={item.name} active={selected_skill?.resource_id === item.resource_id} on_select={() => select_resource(item.route_id)} />)}
        {snapshot && !resources.length ? <EmptyState size="compact" title={normalized_query ? "没有匹配的 Skill" : "还没有 Skill"} /> : null}
      </> : <>
        {!mcp && !mcp_error ? <LoadingState label="正在读取 MCP…" /> : null}
        {mcp_error ? <Callout tone="danger">{mcp_error}</Callout> : null}
        {servers.map((server) => <SidebarItem key={server.id} resource_kind="mcp" label={server.id} trailing={<StatusDot tone={server.state === "ready" ? "success" : server.state === "error" ? "danger" : server.state === "idle" || server.state === "disabled" ? "muted" : "warning"} label={server.state} />} active={resource_id === server.id} on_select={() => select_resource(server.id)} />)}
        {mcp && !servers.length ? <EmptyState size="compact" title={normalized_query ? "没有匹配的 MCP Server" : "还没有 MCP Server"} /> : null}
      </>}
    </SidebarSection>
  </Sidebar>;
}

/** Dispatch detail rendering by resource kind; each detail owns its own asynchronous reads. */
export function skill_resource_mainview(props: PowerMainviewComponentProps) {
  const { EmptyState, Page } = props.ui.components;
  const resource_id = typeof props.navigation.route.resource_id === "string" ? props.navigation.route.resource_id : "";
  if (!resource_id) return <Page><EmptyState title={props.navigation.route.resource_kind === "mcp" ? "选择一个 MCP Server" : "选择一个 Skill"} description={props.navigation.route.resource_kind === "mcp" ? "从左侧列表选择，查看连接状态和工具。" : "从左侧列表选择，阅读技能说明。"} /></Page>;
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
  const { Page, Toolbar, Group, Row, LoadingState, Callout, EmptyState } = ui.components;
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
    {loading || !item || error ? <Toolbar title={item?.name ?? "Skill"} /> : null}
    {error ? <Callout tone="danger">{error}</Callout> : null}
    {loading ? <LoadingState label="正在读取 Skill…" /> : !item ? <EmptyState title="Skill 已不存在" /> : !error ? <Skill_document ui={ui} content={content} fallback_name={item.name} fallback_description={item.description} /> : null}
    {item ? <Group label="详细信息" collapsible default_expanded={false}>
      <Row label="来源" description={`${item.source_label} · ${item.source_path}`} />
      <Row label="使用此 Skill 的 Agent" description={users.map((agent) => agent.name).join("、") || "尚未分配"} />
    </Group> : null}
  </Page>;
}

/** Normalize gateway errors for display. */
export function error_message(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason);
}
