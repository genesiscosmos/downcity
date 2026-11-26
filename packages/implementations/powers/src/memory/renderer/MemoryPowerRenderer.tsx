/** Memory 主导航只管理用户记忆；Agent 私有内容由 Agent Profile 入口独立管理。 */
import { MEMORY_INPUT_RENDERER } from "./MemoryInput.js";
import { define_power_renderer } from "@downcity/city/power/react";
import { MEMORY_ACTIVITY_RENDERER } from "@/builtin/renderer/BuiltinActivity.js";
import type { PowerMainviewComponentProps } from "@downcity/city/power/react";
import { memory_config_view as MemoryConfigView } from "./MemoryConfigView.js";
import { memory_user_view as MemoryUserView } from "./MemoryUserView.js";
import { memory_detail_view } from "./MemoryDetailView.js";
import { memory_job_resource } from "./MemoryJobResource.js";
import { MemoryJobs } from "./MemoryJobs.js";
import { memory_workspace_view as MemoryWorkspaceView } from "./MemoryWorkspaceView.js";
import { memory_agent_view } from "./MemoryAgentView.js";

/** 默认查看用户记忆，处理记录与设置由明确路由打开。 */
function read_view(route: PowerMainviewComponentProps["navigation"]["route"]): "user" | "workspace" | "config" | "jobs" {
  return route.view === "workspace" || route.view === "jobs" || route.view === "config" ? route.view : "user";
}

/** Sidebar 直接展示稳定内容入口，不依赖 Provider 状态或范围目录。 */
export const MEMORY_POWER_RENDERER = define_power_renderer({
  activity: MEMORY_ACTIVITY_RENDERER,
  input: MEMORY_INPUT_RENDERER,
  sidebar: function memory_power_sidebar(props) {
    const { navigation, ui } = props;
    const { Sidebar, SidebarSection, SidebarTreeItem } = ui.components;
    const view = read_view(navigation.route);
    return <Sidebar footer={<SidebarTreeItem kind="leaf" depth={0} label="设置" active={view === "config"}
      on_select={() => navigation.navigate({ view: "config" })} />}>
      <SidebarSection>
        <SidebarTreeItem kind="leaf" depth={0} label="用户记忆"
          active={view === "user"} on_select={() => navigation.navigate({ view: "user" })} />
        <SidebarTreeItem kind="leaf" depth={0} label="项目知识" active={view === "workspace"} on_select={() => navigation.navigate({ view: "workspace" })} />
        <SidebarTreeItem kind="leaf" depth={0} label="处理记录" active={view === "jobs"}
          on_select={() => navigation.navigate({ view: "jobs" })} />
      </SidebarSection>
    </Sidebar>;
  },
  mainview: function memory_power_mainview(props) {
    const view = read_view(props.navigation.route);
    return view === "workspace" ? <MemoryWorkspaceView {...props} /> : view === "config" ? <MemoryConfigView {...props} /> : view === "jobs" ? <MemoryJobs {...props} /> : <MemoryUserView {...props} />;
  },
  views: [{ id: "memory_detail", label: "记忆", component: memory_detail_view }, { id: "memory_job_detail", label: "处理记录", component: memory_job_resource }],
  agent_config: { id: "knowledge", label: "记忆", component: memory_agent_view },
});
