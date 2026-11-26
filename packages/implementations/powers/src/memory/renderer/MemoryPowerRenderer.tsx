/** Memory 主导航只管理用户记忆；Agent 私有内容由 Agent Profile 入口独立管理。 */
import { MEMORY_INPUT_RENDERER } from "./MemoryInput.js";
import { define_power_renderer } from "@downcity/city/power/react";
import { MEMORY_ACTIVITY_RENDERER } from "@/builtin/renderer/BuiltinActivity.js";
import type { PowerPageComponentProps } from "@downcity/city/power/react";
import { memory_config_view as MemoryConfigView } from "./MemoryConfigView.js";
import { memory_user_view as MemoryUserView } from "./MemoryUserView.js";
import { memory_detail_view } from "./MemoryDetailView.js";
import { memory_job_resource } from "./MemoryJobResource.js";
import { MemoryJobs } from "./MemoryJobs.js";
import { memory_workspace_view as MemoryWorkspaceView } from "./MemoryWorkspaceView.js";
import { memory_agent_view } from "./MemoryAgentView.js";

/** 默认查看用户记忆，处理记录与设置由明确路由打开。 */
function read_view(route: PowerPageComponentProps["navigation"]["route"]): "user" | "workspace" | "config" | "jobs" {
  return route.view === "workspace" || route.view === "jobs" || route.view === "config" ? route.view : "user";
}

/** 完整记忆管理页，分类导航与资源列表由业务自行组织。 */
export const MEMORY_POWER_RENDERER = define_power_renderer({
  activity: MEMORY_ACTIVITY_RENDERER,
  input: MEMORY_INPUT_RENDERER,
  page: function memory_page(props) {
    const { Page, Tabs } = props.ui.components;
    const view = read_view(props.navigation.route);
    return <Page><Tabs value={view} label="记忆" items={[
      { value: "user", label: "用户记忆" }, { value: "workspace", label: "项目知识" },
      { value: "jobs", label: "处理记录" }, { value: "config", label: "设置" },
    ]} on_value_change={(value) => props.navigation.navigate({ view: value })} />
      {view === "workspace" ? <MemoryWorkspaceView {...props} /> : view === "config" ? <MemoryConfigView {...props} /> : view === "jobs" ? <MemoryJobs {...props} /> : <MemoryUserView {...props} />}
    </Page>;
  },
  views: [{ id: "memory_detail", label: "记忆", component: memory_detail_view }, { id: "memory_job_detail", label: "处理记录", component: memory_job_resource }],
  agent_config: { id: "knowledge", label: "记忆", component: memory_agent_view },
});
