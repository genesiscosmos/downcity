/** Task Plugin 的专属 Sidebar 与 Mainview。 */

import { useCallback, useEffect, useState } from "react";
import { define_plugin_renderer, type PluginRendererUiComponents } from "@downcity/plugin/react";
import type { TaskMainviewItem, TaskMainviewSnapshot } from "@/task/types/TaskMainview.js";

/** Task Plugin Renderer 定义。 */
export const TASK_PLUGIN_RENDERER = define_plugin_renderer({
  sidebar: function TaskPluginSidebar({ plugin, navigation, ui }) {
    const { Callout, Sidebar, SidebarItem, SidebarSection } = ui.components;
    const [snapshot, set_snapshot] = useState<TaskMainviewSnapshot>();
    const [error, set_error] = useState("");
    const agent_id = read_route(navigation.route.agent_id);
    const workspace_id = read_route(navigation.route.workspace_id);
    const task_title = read_route(navigation.route.task_title);
    useEffect(() => {
      let disposed = false;
      set_error("");
      void plugin.invoke<TaskMainviewSnapshot>("tasks.snapshot", { agent_id, workspace_id })
        .then((next) => {
          if (disposed) return;
          set_snapshot(next);
          const next_agent_id = next.agents.some((agent) => agent.agent_id === agent_id) ? agent_id : next.agents[0]?.agent_id ?? "";
          const next_workspace_id = next.workspaces.some((workspace) => workspace.workspace_id === workspace_id) ? workspace_id : next.workspaces[0]?.workspace_id ?? "";
          if (next_agent_id !== agent_id || next_workspace_id !== workspace_id) {
            navigation.navigate({ agent_id: next_agent_id, workspace_id: next_workspace_id });
          }
        })
        .catch((reason) => { if (!disposed) set_error(reason instanceof Error ? reason.message : String(reason)); });
      return () => { disposed = true; };
    }, [agent_id, navigation.navigate, plugin, workspace_id]);
    return <Sidebar>
      <SidebarSection label="Agents">{snapshot?.agents.map((agent) => <SidebarItem
        key={agent.agent_id}
        label={agent.agent_id}
        active={agent.agent_id === agent_id}
        on_select={() => navigation.navigate({ agent_id: agent.agent_id, workspace_id })}
      />)}</SidebarSection>
      <SidebarSection label="Tasks">{snapshot?.tasks.map((task) => <SidebarItem
        key={task.title}
        label={task.title}
        description={task.when}
        trailing={task.status}
        active={task.title === task_title}
        on_select={() => navigation.navigate({ agent_id, workspace_id, task_title: task.title })}
      />)}</SidebarSection>{error ? <Callout tone="danger">{error}</Callout> : null}
    </Sidebar>;
  },
  mainview: function TaskPluginMainview({ plugin, navigation, ui }) {
    const { Callout, CodeBlock, EmptyState, Group, LoadingState, Page, Row, Select, Status, Toolbar } = ui.components;
    const agent_id = read_route(navigation.route.agent_id);
    const workspace_id = read_route(navigation.route.workspace_id);
    const task_title = read_route(navigation.route.task_title);
    const [snapshot, set_snapshot] = useState<TaskMainviewSnapshot>();
    const [loading, set_loading] = useState(true);
    const [error, set_error] = useState("");
    const refresh = useCallback(async () => {
      set_loading(true);
      set_error("");
      try {
        set_snapshot(await plugin.invoke<TaskMainviewSnapshot>("tasks.snapshot", { agent_id, workspace_id }));
      } catch (reason) {
        set_error(reason instanceof Error ? reason.message : String(reason));
      } finally {
        set_loading(false);
      }
    }, [agent_id, plugin, workspace_id]);
    useEffect(() => { void refresh(); }, [refresh]);
    if (loading && !snapshot) return <LoadingState label="正在读取 Tasks…" />;
    if (!snapshot?.agents.length) return <EmptyState title="没有启用 Task 的 Agent" description="先在 Agent 配置中启用 Task Plugin。" />;
    if (!snapshot.workspaces.length) return <EmptyState title="还没有 Workspace" description="Task 需要一个 Workspace 执行上下文。" />;
    const task = snapshot.tasks.find((item) => item.title === task_title);
    return <Page>
      <Toolbar
        title={agent_id || "Tasks"}
        description="Task 状态来自当前 Agent Plugin runtime。"
        actions={<Select value={workspace_id} options={snapshot.workspaces.map((workspace) => ({ value: workspace.workspace_id, label: workspace.name }))} on_value_change={(value) => navigation.navigate({ agent_id, workspace_id: value })} />}
      />
      {error ? <Callout tone="danger">{error}</Callout> : null}
      {task ? <TaskDetails task={task} components={{ CodeBlock, Group, Row, Status }} />
        : !snapshot.tasks.length ? <EmptyState title="这个 Agent 还没有 Task" />
          : <Group>{snapshot.tasks.map((item) => <Row key={item.title} label={item.title} description={item.description} trailing={<Status>{item.status}</Status>} on_click={() => navigation.navigate({ agent_id, workspace_id, task_title: item.title })} />)}</Group>}
    </Page>;
  },
});

/** 展示一个 Task 的定义详情。 */
function TaskDetails({ task, components }: {
  /** 当前 Task。 */ readonly task: TaskMainviewItem;
  /** Task 详情使用的宿主组件。 */ readonly components: Pick<PluginRendererUiComponents, "CodeBlock" | "Group" | "Row" | "Status">;
}) {
  const { CodeBlock, Group, Row, Status } = components;
  return <>
    <Group>
      <Row label="状态" trailing={<Status>{task.status}</Status>} />
      <Row label="触发" trailing={task.when} />
      <Row label="类型" trailing={task.kind || "agent"} />
      <Row label="Session" trailing={task.session_id} />
      {task.last_run_at ? <Row label="最近运行" trailing={task.last_run_at} /> : null}
    </Group>
    <CodeBlock>{task.body || task.description || "Task 没有正文"}</CodeBlock>
  </>;
}

/** 从宿主 JSON 路由读取一个可选字符串。 */
function read_route(value: unknown): string {
  return typeof value === "string" ? value : "";
}
