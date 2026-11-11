/** Memory Power 导航：Power 配置与处理记录两个入口，后台整理直接位于 Provider 页。 */
import { createElement, useState } from "react";
import { define_power_renderer } from "@downcity/city/power/react";
import type { PowerAgentConfigComponentProps, PowerMainviewComponentProps } from "@downcity/city/power/react";
import { memory_config_view as MemoryConfigView, provider_state_label, use_memory_config } from "./MemoryConfigView.js";
import { MemoryJobs } from "./MemoryJobs.js";
import { memory_knowledge_view as MemoryKnowledgeView } from "./MemoryKnowledgeView.js";

/** 只接受明确的管理入口，其余路由进入当前 Provider。 */
function read_view(route: PowerMainviewComponentProps["navigation"]["route"]): "config" | "jobs" {
  return route.view === "jobs" ? "jobs" : "config";
}

/** Agent 自身页面拥有内容导航，身份固定为宿主注入的 Agent。 */
function memory_agent_knowledge({ agent_id, power, ui }: PowerAgentConfigComponentProps) {
  const [route, set_route] = useState<PowerMainviewComponentProps["navigation"]["route"]>({});
  return <MemoryKnowledgeView power={power} ui={ui} notifications={[]} navigation={{
    route: { ...route, scope: "agent", agent_id }, navigate: set_route,
  }} />;
}

/** Sidebar 不查询任何 Agent 或知识数量；单个 Provider 不制造切换操作。 */
export const MEMORY_POWER_RENDERER = define_power_renderer({
  sidebar: function memory_power_sidebar(props) {
    const { navigation, ui } = props;
    const { Callout, LoadingState, Sidebar, SidebarSection, SidebarTreeItem, Status } = ui.components;
    const { snapshot, error } = use_memory_config(props);
    const view = read_view(navigation.route);
    if (!snapshot) return <Sidebar>{error
      ? <Callout tone="danger">{error}</Callout>
      : <LoadingState label="正在读取 Memory 配置…" />}</Sidebar>;
    return <Sidebar>
      <SidebarSection>
        <SidebarTreeItem kind="leaf" depth={0} label="配置"
          trailing={<Status tone={snapshot.knowledge.status.state === "ready" ? "success" : "warning"}>{provider_state_label(snapshot.knowledge.status.state)}</Status>}
          active={view === "config"} on_select={() => navigation.navigate({ view: "config" })} />
        <SidebarTreeItem kind="leaf" depth={0} label="处理记录" active={view === "jobs"}
          on_select={() => navigation.navigate({ view: "jobs" })} />
      </SidebarSection>
      {error ? <Callout tone="danger">{error}</Callout> : null}
    </Sidebar>;
  },
  mainview: function memory_power_mainview(props) {
    const view = read_view(props.navigation.route);
    return view === "config" ? <MemoryConfigView {...props} /> : <MemoryJobs {...props} />;
  },
  agent_config: { id: "knowledge", label: "记忆", component: (props) => createElement(memory_agent_knowledge, { ...props, key: props.agent_id }) },
});
