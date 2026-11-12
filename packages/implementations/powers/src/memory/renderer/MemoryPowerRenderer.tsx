/** Memory 主导航只管理用户记忆；Agent 私有内容由 Agent Profile 入口独立管理。 */
import { define_power_renderer } from "@downcity/city/power/react";
import type { PowerMainviewComponentProps } from "@downcity/city/power/react";
import { memory_config_view as MemoryConfigView } from "./MemoryConfigView.js";
import { memory_user_view as MemoryUserView } from "./MemoryUserView.js";
import { memory_detail_view } from "./MemoryDetailView.js";
import { MemoryJobs } from "./MemoryJobs.js";
import { memory_agent_view } from "./MemoryAgentView.js";

/** 默认查看用户记忆，处理记录与设置由明确路由打开。 */
function read_view(route: PowerMainviewComponentProps["navigation"]["route"]): "user" | "config" | "jobs" {
  return route.view === "jobs" || route.view === "config" ? route.view : "user";
}

/** Sidebar 直接展示稳定内容入口，不依赖 Provider 状态或范围目录。 */
export const MEMORY_POWER_RENDERER = define_power_renderer({
  sidebar: function memory_power_sidebar(props) {
    const { navigation, ui } = props;
    const { Sidebar, SidebarSection, SidebarTreeItem } = ui.components;
    const view = read_view(navigation.route);
    return <Sidebar footer={<SidebarTreeItem kind="leaf" depth={0} label="设置" active={view === "config"}
      on_select={() => navigation.navigate({ view: "config" })} />}>
      <SidebarSection>
        <SidebarTreeItem kind="leaf" depth={0} label="用户记忆"
          active={view === "user"} on_select={() => navigation.navigate({ view: "user" })} />
        <SidebarTreeItem kind="leaf" depth={0} label="处理记录" active={view === "jobs"}
          on_select={() => navigation.navigate({ view: "jobs" })} />
      </SidebarSection>
    </Sidebar>;
  },
  mainview: function memory_power_mainview(props) {
    const view = read_view(props.navigation.route);
    return view === "config" ? <MemoryConfigView {...props} /> : view === "jobs" ? <MemoryJobs {...props} /> : <MemoryUserView {...props} />;
  },
  views: [{ id: "memory_detail", label: "记忆", component: memory_detail_view }],
  agent_config: { id: "knowledge", label: "记忆", component: memory_agent_view },
});
