/**
 * Task Plugin 的功能工作区。
 *
 * Sidebar 按 Agent 聚合全部 Task；Mainview 承担创建、编辑、定义查看和执行记录查看。
 * Workspace 是 Task 自身的执行配置，不参与页面筛选和导航。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { define_plugin_renderer, type PluginRendererNotification, type PluginRendererUiComponents } from "@downcity/plugin/react";
import type { TaskRunDetailView, TaskRunHistoryItemView } from "@/task/types/TaskCommand.js";
import type { TaskMainviewEditorDraft, TaskMainviewHistorySnapshot, TaskMainviewItem, TaskMainviewMutationResult, TaskMainviewRunDetailSnapshot, TaskMainviewSnapshot } from "@/task/types/TaskMainview.js";
import { TaskEditor } from "@/task/renderer/TaskEditor.js";

/** Task Plugin Renderer 定义。 */
export const TASK_PLUGIN_RENDERER = define_plugin_renderer({
  sidebar: function TaskPluginSidebar({ plugin, navigation, notifications, ui }) {
    const { Callout, ItemMenu, LoadingState, Sidebar, SidebarSection, SidebarTreeItem } = ui.components;
    const [snapshot, set_snapshot] = useState<TaskMainviewSnapshot>();
    const [loaded_revision, set_loaded_revision] = useState(-1);
    const [expanded_agent_ids, set_expanded_agent_ids] = useState<Set<string>>(new Set());
    const [expanded_task_keys, set_expanded_task_keys] = useState<Set<string>>(new Set());
    const [history_by_task, set_history_by_task] = useState<Record<string, TaskRunHistoryItemView[]>>({});
    const [loading_task_keys, set_loading_task_keys] = useState<Set<string>>(new Set());
    const [error, set_error] = useState("");
    const [busy_task_key, set_busy_task_key] = useState("");
    const auto_expanded_agent_id = useRef("");
    const agent_id = read_route(navigation.route.agent_id);
    const task_title = read_route(navigation.route.task_title);
    const view = read_route(navigation.route.view);

    useEffect(() => {
      let disposed = false;
      set_error("");
      void plugin.invoke<TaskMainviewSnapshot>("tasks.snapshot")
        .then((next) => {
          if (disposed) return;
          set_snapshot(next);
          set_loaded_revision(ui.revision);
          set_history_by_task({});
          set_expanded_agent_ids((current) => new Set([...current].filter((current_agent_id) => next.agents.some((agent) => agent.agent_id === current_agent_id))));
        })
        .catch((reason) => { if (!disposed) set_error(to_error_message(reason)); });
      return () => { disposed = true; };
    }, [plugin, ui.revision]);

    useEffect(() => {
      if (!snapshot || loaded_revision !== ui.revision) return;
      const next_agent_id = snapshot.agents.some((agent) => agent.agent_id === agent_id) ? agent_id : snapshot.agents[0]?.agent_id ?? "";
      const next_agent = snapshot.agents.find((agent) => agent.agent_id === next_agent_id);
      const next_task_title = next_agent?.tasks.some((task) => task.title === task_title) ? task_title : "";
      if (next_agent_id !== agent_id || next_task_title !== task_title) navigation.navigate(next_task_title ? task_route(next_agent_id, next_task_title) : agent_route(next_agent_id));
    }, [agent_id, loaded_revision, navigation.navigate, snapshot, task_title, ui.revision]);

    useEffect(() => {
      if (!snapshot || !agent_id || auto_expanded_agent_id.current === agent_id) return;
      auto_expanded_agent_id.current = agent_id;
      set_expanded_agent_ids((current) => current.has(agent_id) ? current : new Set(current).add(agent_id));
    }, [agent_id, snapshot]);

    useEffect(() => {
      if (!snapshot || !agent_id || !task_title) return;
      const selected_task = snapshot.agents.find((agent) => agent.agent_id === agent_id)?.tasks.find((task) => task.title === task_title);
      if (!selected_task) return;
      const task_key = `${agent_id}:${task_title}`;
      if (!expanded_task_keys.has(task_key)) void toggle_task(agent_id, selected_task);
    }, [agent_id, snapshot, task_title]);

    const invoke_task_action = async (task: TaskMainviewItem, action: "run" | "status" | "delete", input?: Record<string, string>) => {
      set_busy_task_key(`${agent_id}:${task.title}`);
      set_error("");
      try {
        await plugin.invoke<TaskMainviewMutationResult>(`tasks.${action}`, { ...task_action_input(agent_id, task), ...input });
        if (action === "delete") navigation.navigate(agent_route(agent_id));
        else if (action === "run") navigation.navigate(pending_run_route(agent_id, task.title, Date.now()));
        ui.invalidate();
        ui.toast({ type: "success", message: action === "run" ? "Task 已开始运行" : action === "delete" ? "Task 已删除" : "Task 状态已更新" });
      } catch (reason) {
        const message = to_error_message(reason);
        set_error(message);
        ui.toast({ type: "error", message });
      } finally {
        set_busy_task_key("");
      }
    };

    const remove_task = async (task: TaskMainviewItem) => {
      const confirmed = await ui.confirm({ title: `删除 ${task.title}？`, description: "Task 定义及其全部执行记录都会被永久删除。", action: "删除", destructive: true });
      if (confirmed) await invoke_task_action(task, "delete");
    };
    const task_menu = (task: TaskMainviewItem) => <ItemMenu label={`${task.title} 操作`} reveal_on_hover actions={[
      { action_id: "run", label: "立即运行", disabled: Boolean(busy_task_key), on_select: () => invoke_task_action(task, "run") },
      { action_id: "edit", label: "编辑", disabled: Boolean(busy_task_key), on_select: () => navigation.navigate(edit_task_route(agent_id, task.title)) },
      { action_id: "status", label: task.status === "enabled" ? "暂停" : "启用", disabled: Boolean(busy_task_key), on_select: () => invoke_task_action(task, "status", { status: task.status === "enabled" ? "paused" : "enabled" }) },
      { action_id: "delete", label: "删除", separator_before: true, destructive: true, disabled: Boolean(busy_task_key), on_select: () => remove_task(task) },
    ]} />;
    const toggle_task = async (selected_agent_id: string, task: TaskMainviewItem) => {
      const task_key = `${selected_agent_id}:${task.title}`;
      const expanding = !expanded_task_keys.has(task_key);
      set_expanded_task_keys((current) => toggle_key(current, task_key));
      if (!expanding || history_by_task[task_key] || loading_task_keys.has(task_key)) return;
      set_loading_task_keys((current) => new Set(current).add(task_key));
      try {
        const next = await plugin.invoke<TaskMainviewHistorySnapshot>("tasks.history", task_action_input(selected_agent_id, task));
        set_history_by_task((current) => ({ ...current, [task_key]: next.runs }));
      } catch (reason) {
        set_error(to_error_message(reason));
      } finally {
        set_loading_task_keys((current) => { const next = new Set(current); next.delete(task_key); return next; });
      }
    };

    if (!snapshot) return <Sidebar>{error ? <Callout tone="danger">{error}</Callout> : <LoadingState label="正在读取 Tasks…" />}</Sidebar>;
    return <Sidebar>
      <SidebarSection label="Agents">
        {snapshot.agents.map((agent) => {
          const expanded = expanded_agent_ids.has(agent.agent_id);
          const agent_has_unread = notifications.some((notification) => read_route(notification.route.agent_id) === agent.agent_id);
          return <div key={agent.agent_id}>
            <SidebarTreeItem depth={0} kind="branch" label={<span className="flex min-w-0 items-center gap-1.5"><span className="truncate">{agent.name}</span>{agent_has_unread ? <UnreadDot /> : null}</span>} trailing={agent.tasks.length} active={agent.agent_id === agent_id && !task_title} expanded={expanded} on_toggle={() => set_expanded_agent_ids((current) => toggle_key(current, agent.agent_id))} on_select={() => navigation.navigate(agent_route(agent.agent_id))} />
            {expanded ? <div className="flex flex-col gap-0.5">{agent.tasks.map((task) => {
              const notification = find_task_notification(notifications, agent.agent_id, task.title);
              const task_key = `${agent.agent_id}:${task.title}`;
              const task_expanded = expanded_task_keys.has(task_key);
              const runs = history_by_task[task_key] ?? [];
              return <div key={task.title}>
                <SidebarTreeItem kind="branch" depth={1} label={task.title} trailing={<span className="flex items-center gap-0.5">{notification ? <UnreadDot /> : null}{task_menu(task)}</span>} active={agent.agent_id === agent_id && task.title === task_title && view !== "run"} expanded={task_expanded} on_toggle={() => void toggle_task(agent.agent_id, task)} on_select={() => navigation.navigate(task_definition_route(agent.agent_id, task.title))} />
                {task_expanded ? <div className="flex flex-col gap-0.5">
                  {runs.map((run) => <SidebarTreeItem key={run.timestamp} kind="leaf" depth={2} label={format_run_time(run.started_at)} trailing={run.status === "running" ? "运行中" : undefined} active={agent.agent_id === agent_id && task.title === task_title && view === "run" && read_route(navigation.route.run_timestamp) === run.timestamp} on_select={() => navigation.navigate(task_run_route(agent.agent_id, task.title, run.timestamp))} />)}
                  {loading_task_keys.has(task_key) ? <div className="py-1 pl-12 text-[10px] text-muted-foreground/55">正在读取…</div> : null}
                  {!loading_task_keys.has(task_key) && runs.length === 0 ? <div className="py-1 pl-12 text-[10px] text-muted-foreground/55">暂无执行记录</div> : null}
                </div> : null}
              </div>;
            })}</div> : null}
            {expanded && agent.tasks.length === 0 ? <div style={{ paddingLeft: 24 }}><div className="flex min-h-8 items-center rounded-lg py-0.5 pl-2 pr-1 text-[10px] text-muted-foreground/50">没有 Task</div></div> : null}
          </div>;
        })}
        {!snapshot.agents.length ? <div className="px-2 py-1 text-[10px] text-muted-foreground/55">没有启用 Task 的 Agent</div> : null}
      </SidebarSection>
      {error ? <Callout tone="danger">{error}</Callout> : null}
    </Sidebar>;
  },

  mainview: function TaskPluginMainview({ plugin, navigation, notifications, ui }) {
    const { Button, Callout, CodeBlock, EmptyState, Group, ItemMenu, LoadingState, Markdown, Page, Row, Section, Status, Toolbar } = ui.components;
    const agent_id = read_route(navigation.route.agent_id);
    const task_title = read_route(navigation.route.task_title);
    const view = read_route(navigation.route.view);
    const run_timestamp = read_route(navigation.route.run_timestamp);
    const pending_started_at = read_route_number(navigation.route.run_started_at);
    const [snapshot, set_snapshot] = useState<TaskMainviewSnapshot>();
    const [loaded_revision, set_loaded_revision] = useState(-1);
    const [history, set_history] = useState<TaskRunHistoryItemView[]>([]);
    const [loaded_history_key, set_loaded_history_key] = useState("");
    const [run_detail, set_run_detail] = useState<TaskRunDetailView>();
    const [loading, set_loading] = useState(true);
    const [history_loading, set_history_loading] = useState(false);
    const [run_loading, set_run_loading] = useState(false);
    const [busy, set_busy] = useState(false);
    const [error, set_error] = useState("");
    const [history_error, set_history_error] = useState("");
    const [run_error, set_run_error] = useState("");
    const history_request_key = useRef("");

    const refresh_snapshot = useCallback(async () => {
      set_loading(true);
      set_error("");
      try {
        set_snapshot(await plugin.invoke<TaskMainviewSnapshot>("tasks.snapshot"));
        set_loaded_revision(ui.revision);
      }
      catch (reason) { set_error(to_error_message(reason)); }
      finally { set_loading(false); }
    }, [plugin, ui.revision]);
    useEffect(() => { void refresh_snapshot(); }, [refresh_snapshot, ui.revision]);

    const agent = snapshot?.agents.find((item) => item.agent_id === agent_id) ?? snapshot?.agents[0];
    const task = agent?.tasks.find((item) => item.title === task_title);
    const history_key = task && agent ? `${agent.agent_id}:${task.title}:${task.workspace_id}` : "";
    const visible_history = useMemo(() => loaded_history_key === history_key ? history : [], [history, history_key, loaded_history_key]);
    const selected_run_updated_at = visible_history.find((run) => run.timestamp === run_timestamp)?.updated_at ?? 0;

    useEffect(() => {
      if (!snapshot?.agents.length || loaded_revision !== ui.revision) return;
      if (!agent_id || !snapshot.agents.some((item) => item.agent_id === agent_id)) {
        navigation.navigate(agent_route(snapshot.agents[0].agent_id));
        return;
      }
      if (task_title && !task && view !== "create") navigation.navigate(agent_route(agent_id));
    }, [agent_id, loaded_revision, navigation.navigate, snapshot, task, task_title, ui.revision, view]);

    const load_history = useCallback(async () => {
      history_request_key.current = history_key;
      if (!agent || !task) {
        set_history([]);
        set_loaded_history_key(history_key);
        set_history_loading(false);
        return;
      }
      set_history_loading(true);
      set_history_error("");
      try {
        const next = await plugin.invoke<TaskMainviewHistorySnapshot>("tasks.history", task_action_input(agent.agent_id, task));
        if (history_request_key.current !== history_key) return;
        set_history(next.runs);
        set_loaded_history_key(history_key);
      } catch (reason) {
        if (history_request_key.current !== history_key) return;
        set_history([]);
        set_loaded_history_key(history_key);
        set_history_error(to_error_message(reason));
      } finally {
        if (history_request_key.current === history_key) set_history_loading(false);
      }
    }, [agent, history_key, plugin, task]);
    useEffect(() => { void load_history(); }, [load_history, ui.revision]);

    useEffect(() => {
      if ((!visible_history.some((run) => run.status === "running") && view !== "run_pending") || !task) return;
      const timer = window.setInterval(() => { void load_history(); }, view === "run_pending" ? 1000 : 3000);
      return () => window.clearInterval(timer);
    }, [load_history, task, view, visible_history]);

    useEffect(() => {
      if (view !== "run_pending" || !agent || !task || loaded_history_key !== history_key) return;
      const started_run = visible_history.find((run) => run.started_at >= pending_started_at - 2000);
      if (started_run) navigation.navigate(task_run_route(agent.agent_id, task.title, started_run.timestamp));
    }, [agent, history_key, loaded_history_key, navigation.navigate, pending_started_at, task, view, visible_history]);

    useEffect(() => {
      if (!task || history_loading || loaded_history_key !== history_key || view === "task" || view === "edit" || view === "run_pending") return;
      const selected_exists = view === "run" && visible_history.some((run) => run.timestamp === run_timestamp);
      if (selected_exists) return;
      const latest = visible_history[0];
      navigation.navigate(latest ? task_run_route(agent?.agent_id ?? agent_id, task.title, latest.timestamp) : task_definition_route(agent?.agent_id ?? agent_id, task.title));
    }, [agent?.agent_id, agent_id, history_key, history_loading, loaded_history_key, navigation.navigate, run_timestamp, task, view, visible_history]);

    useEffect(() => {
      if (view !== "run" || !agent || !task || !run_timestamp) {
        set_run_detail(undefined);
        set_run_error("");
        return;
      }
      let disposed = false;
      set_run_detail((current) => current?.timestamp === run_timestamp ? current : undefined);
      set_run_loading(true);
      set_run_error("");
      void plugin.invoke<TaskMainviewRunDetailSnapshot>("tasks.run_detail", { ...task_action_input(agent.agent_id, task), timestamp: run_timestamp })
        .then((next) => { if (!disposed) set_run_detail(next.run); })
        .catch((reason) => { if (!disposed) set_run_error(to_error_message(reason)); })
        .finally(() => { if (!disposed) set_run_loading(false); });
      return () => { disposed = true; };
    }, [agent, plugin, run_timestamp, selected_run_updated_at, task, view]);

    const invoke_mutation = async (action: "create" | "update" | "status" | "run" | "delete", input: Record<string, unknown>) => {
      set_busy(true);
      set_error("");
      try { return await plugin.invoke<TaskMainviewMutationResult>(`tasks.${action}`, input as never); }
      catch (reason) {
        const message = to_error_message(reason);
        set_error(message);
        ui.toast({ type: "error", message });
        throw reason;
      } finally { set_busy(false); }
    };

    const save_task = async (draft: TaskMainviewEditorDraft) => {
      if (!agent) return;
      try {
        await invoke_mutation(task ? "update" : "create", { agent_id: agent.agent_id, ...(task ? { current_title: task.title } : {}), ...draft });
        navigation.navigate(task_definition_route(agent.agent_id, draft.title));
        ui.invalidate();
        ui.toast({ type: "success", message: task ? "Task 已更新" : "Task 已创建" });
      } catch {}
    };
    const run_task = async (selected_task: TaskMainviewItem) => {
      if (!agent) return;
      const started_at = Date.now();
      try {
        await invoke_mutation("run", task_action_input(agent.agent_id, selected_task));
        navigation.navigate(pending_run_route(agent.agent_id, selected_task.title, started_at));
        ui.invalidate();
        ui.toast({ type: "success", message: "Task 已开始运行" });
      } catch {}
    };
    const set_status = async (selected_task: TaskMainviewItem) => {
      if (!agent) return;
      try {
        await invoke_mutation("status", { ...task_action_input(agent.agent_id, selected_task), status: selected_task.status === "enabled" ? "paused" : "enabled" });
        ui.invalidate();
        ui.toast({ type: "success", message: selected_task.status === "enabled" ? "Task 已暂停" : "Task 已启用" });
      } catch {}
    };
    const remove_task = async (selected_task: TaskMainviewItem) => {
      if (!agent) return;
      const confirmed = await ui.confirm({ title: `删除 ${selected_task.title}？`, description: "Task 定义及其全部执行记录都会被永久删除。", action: "删除", destructive: true });
      if (!confirmed) return;
      try {
        await invoke_mutation("delete", task_action_input(agent.agent_id, selected_task));
        navigation.navigate(agent_route(agent.agent_id));
        ui.invalidate();
        ui.toast({ type: "success", message: "Task 已删除" });
      } catch {}
    };
    const task_menu = (selected_task: TaskMainviewItem, reveal_on_hover = false) => <ItemMenu label={`${selected_task.title} 操作`} reveal_on_hover={reveal_on_hover} actions={[
      { action_id: "run", label: "立即运行", disabled: busy, on_select: () => run_task(selected_task) },
      { action_id: "edit", label: "编辑", disabled: busy, on_select: () => navigation.navigate(edit_task_route(agent?.agent_id ?? agent_id, selected_task.title)) },
      { action_id: "status", label: selected_task.status === "enabled" ? "暂停" : "启用", disabled: busy, on_select: () => set_status(selected_task) },
      { action_id: "delete", label: "删除", separator_before: true, destructive: true, disabled: busy, on_select: () => remove_task(selected_task) },
    ]} />;
    const task_management_menu = (selected_task: TaskMainviewItem) => <ItemMenu label={`${selected_task.title} 更多操作`} actions={[
      { action_id: "status", label: selected_task.status === "enabled" ? "暂停" : "启用", disabled: busy, on_select: () => set_status(selected_task) },
      { action_id: "delete", label: "删除", separator_before: true, destructive: true, disabled: busy, on_select: () => remove_task(selected_task) },
    ]} />;

    if (loading && !snapshot) return <LoadingState label="正在读取 Tasks…" />;
    if (!snapshot?.agents.length) return <EmptyState title="没有启用 Task 的 Agent" description="先在 Agent 配置中启用 Task Plugin。" />;
    if (!agent) return <EmptyState title="Agent 不存在" />;
    if (view === "create") {
      if (!snapshot.workspaces.length) return <Page><EmptyState title="还没有 Workspace" description="创建 Task 前需要先添加一个可执行 Workspace。" /></Page>;
      return <TaskEditor mode="create" workspaces={snapshot.workspaces} busy={busy} error={error} components={ui.components} on_cancel={() => navigation.navigate(agent_route(agent.agent_id))} on_submit={save_task} />;
    }
    if (task && view === "edit") return <TaskEditor mode="edit" task={task} workspaces={snapshot.workspaces} busy={busy} error={error} components={ui.components} on_cancel={() => navigation.navigate(task_definition_route(agent.agent_id, task.title))} on_submit={save_task} />;
    if (!task) return <Page>
      <Toolbar title={agent.agent_id} description={`${agent.tasks.length} Tasks`} actions={<Button variant="primary" disabled={!snapshot.workspaces.length} on_click={() => navigation.navigate(create_task_route(agent.agent_id))}>新建 Task</Button>} />
      {error ? <Callout tone="danger">{error}</Callout> : null}
      {!agent.tasks.length ? <EmptyState title="这个 Agent 还没有 Task" description="创建一个手动、定时或脚本 Task。" action={<Button variant="primary" disabled={!snapshot.workspaces.length} on_click={() => navigation.navigate(create_task_route(agent.agent_id))}>新建 Task</Button>} />
        : <Group>{agent.tasks.map((item) => {
          const notification = find_task_notification(notifications, agent.agent_id, item.title);
          return <Row key={item.title} label={item.title} description={`${item.description} · ${workspace_name(snapshot, item.workspace_id)}`} trailing={<>{notification ? <UnreadDot /> : null}{task_menu(item, true)}</>} on_click={() => navigation.navigate(notification?.route ?? task_route(agent.agent_id, item.title))} />;
        })}</Group>}
    </Page>;

    return <>
      {view === "run" ? <TaskRunDetails run={run_detail} loading={run_loading} error={run_error || history_error} components={{ Callout, EmptyState, Group, LoadingState, Markdown, Page, Row, Section, Status, Toolbar }} />
        : view === "run_pending" ? <Page><Toolbar title={task.title} description="Task 已受理" /><LoadingState label="正在等待执行记录…" /></Page>
          : <Page>
            <Toolbar title={task.title} description={task.description} actions={<><Button disabled={busy} on_click={() => navigation.navigate(edit_task_route(agent.agent_id, task.title))}>编辑</Button><Button variant="primary" disabled={busy} on_click={() => void run_task(task)}>{busy ? "处理中…" : "立即运行"}</Button>{task_management_menu(task)}</>} />
            {error || history_error ? <Callout tone="danger">{error || history_error}</Callout> : null}
            <TaskDetails task={task} workspace_label={workspace_name(snapshot, task.workspace_id)} components={{ CodeBlock, Group, Row, Status }} />
          </Page>}
    </>;
  },
});

/** 展示一次 Task Run 的状态、最终输出与失败信息。 */
function TaskRunDetails({ run, loading, error, components }: {
  /** 当前选择的执行记录。 */ readonly run?: TaskRunDetailView;
  /** 是否正在读取执行详情。 */ readonly loading: boolean;
  /** 执行详情读取错误。 */ readonly error: string;
  /** 执行详情使用的宿主组件。 */ readonly components: Pick<PluginRendererUiComponents, "Callout" | "EmptyState" | "Group" | "LoadingState" | "Markdown" | "Page" | "Row" | "Section" | "Status" | "Toolbar">;
}) {
  const { Callout, EmptyState, Group, LoadingState, Markdown, Page, Row, Section, Status, Toolbar } = components;
  if (loading && !run) return <LoadingState label="正在读取执行详情…" />;
  if (!run) return <Page>{error ? <Callout tone="danger">{error}</Callout> : <EmptyState title="执行记录不存在" />}</Page>;
  return <Page>
    <Toolbar title={format_run_time(run.started_at)} description={`${run_status_label(run.status)} · ${trigger_label(run.trigger)}${run.duration_ms !== undefined ? ` · ${format_duration(run.duration_ms)}` : ""}`} />
    {error ? <Callout tone="danger">{error}</Callout> : null}
    <Group>
      <Row label="状态" trailing={<Status tone={run_status_tone(run.status)}>{run_status_label(run.status)}</Status>} />
      <Row label="触发" trailing={trigger_label(run.trigger)} />
      <Row label="开始时间" trailing={format_run_time(run.started_at)} />
      {run.ended_at ? <Row label="结束时间" trailing={format_run_time(run.ended_at)} /> : null}
      {run.duration_ms !== undefined ? <Row label="耗时" trailing={format_duration(run.duration_ms)} /> : null}
      {run.execution_status ? <Row label="执行状态" trailing={<Status tone={run_status_tone(run.execution_status)}>{run.execution_status}</Status>} /> : null}
      {run.result_status ? <Row label="结果校验" trailing={<Status tone={run.result_status === "invalid" ? "danger" : "muted"}>{run.result_status}</Status>} /> : null}
      {run.dialogue_rounds !== undefined ? <Row label="执行轮数" trailing={String(run.dialogue_rounds)} /> : null}
    </Group>
    {run.status === "running" ? <EmptyState title="Task 正在执行" description={run.message || "执行完成后会在这里显示最终输出。"} size="compact" /> : <Section title="最终输出">{run.output ? <Markdown text={run.output} /> : <EmptyState title="本次执行没有输出" size="compact" />}</Section>}
    {run.error_detail || run.error ? <Section title="错误信息"><Callout tone="danger">{run.error_detail || run.error}</Callout></Section> : null}
    {run.result_errors.length ? <Section title="校验失败"><Callout tone="warning">{run.result_errors.join("\n")}</Callout></Section> : null}
  </Page>;
}

/** 展示一个 Task 的只读定义详情。 */
function TaskDetails({ task, workspace_label, components }: {
  /** 当前 Task。 */ readonly task: TaskMainviewItem;
  /** 当前 Task 执行 Workspace 的用户可见名称。 */ readonly workspace_label: string;
  /** Task 详情使用的宿主组件。 */ readonly components: Pick<PluginRendererUiComponents, "CodeBlock" | "Group" | "Row" | "Status">;
}) {
  const { CodeBlock, Group, Row, Status } = components;
  return <>
    <Group>
      <Row label="状态" trailing={<Status>{task.status}</Status>} />
      <Row label="Workspace" trailing={workspace_label} />
      <Row label="触发" trailing={task.when} />
      <Row label="类型" trailing={task.kind || "agent"} />
      {task.kind !== "script" ? <Row label="多轮复核" trailing={task.review ? "启用" : "关闭"} /> : null}
      {task.session_id ? <Row label="结果 Session" trailing={task.session_id} /> : null}
      {task.last_run_at ? <Row label="最近运行" trailing={task.last_run_at} /> : null}
    </Group>
    <CodeBlock>{task.body || task.description || "Task 没有正文"}</CodeBlock>
  </>;
}

/** 创建已有 Task action 的统一输入。 */
function task_action_input(agent_id: string, task: TaskMainviewItem) { return { agent_id, workspace_id: task.workspace_id, task_title: task.title }; }
/** 读取 Workspace 的用户可见名称，失配时保留稳定 ID。 */
function workspace_name(snapshot: TaskMainviewSnapshot, workspace_id: string): string { return snapshot.workspaces.find((workspace) => workspace.workspace_id === workspace_id)?.name ?? workspace_id; }
/** 从宿主 JSON 路由读取一个可选字符串。 */
function read_route(value: unknown): string { return typeof value === "string" ? value : ""; }
/** 从宿主 JSON 路由读取一个可选数字。 */
function read_route_number(value: unknown): number { return typeof value === "number" && Number.isFinite(value) ? value : 0; }
/** 创建 Agent 集合页路由。 */
function agent_route(agent_id: string) { return { agent_id }; }
/** 创建 Task 默认详情路由。 */
function task_route(agent_id: string, task_title: string) { return { agent_id, task_title }; }
/** 创建 Task 定义详情路由。 */
function task_definition_route(agent_id: string, task_title: string) { return { agent_id, task_title, view: "task" }; }
/** 创建 Task 新建页路由。 */
function create_task_route(agent_id: string) { return { agent_id, view: "create" }; }
/** 创建 Task 编辑页路由。 */
function edit_task_route(agent_id: string, task_title: string) { return { agent_id, task_title, view: "edit" }; }
/** 创建等待新执行记录的路由。 */
function pending_run_route(agent_id: string, task_title: string, run_started_at: number) { return { agent_id, task_title, view: "run_pending", run_started_at }; }
/** 创建单次 Task Run 详情路由。 */
function task_run_route(agent_id: string, task_title: string, run_timestamp: string) { return { agent_id, task_title, view: "run", run_timestamp }; }
/** 查找一个 Task 或具体 Run 对应的未读通知。 */
function find_task_notification(
  notifications: readonly PluginRendererNotification[],
  agent_id: string,
  task_title: string,
  run_timestamp?: string,
): PluginRendererNotification | undefined {
  return notifications.find((notification) => read_route(notification.route.agent_id) === agent_id
    && read_route(notification.route.task_title) === task_title
    && (run_timestamp === undefined || read_route(notification.route.run_timestamp) === run_timestamp));
}
/** Task 导航中统一使用的未读蓝点。 */
function UnreadDot() { return <span aria-label="未读" className="inline-block size-1.5 shrink-0 rounded-full bg-blue-500" />; }
/** 将未知失败转换为用户可见错误文本。 */
function to_error_message(reason: unknown): string { return reason instanceof Error ? reason.message : String(reason); }
/** 将执行状态转换为中文标签。 */
function run_status_label(status: string): string {
  if (status === "running") return "运行中";
  if (status === "success") return "成功";
  if (status === "failure") return "失败";
  if (status === "skipped") return "已跳过";
  return status;
}
/** 将执行状态映射到宿主的轻量状态色。 */
function run_status_tone(status: string): "success" | "warning" | "danger" | "muted" {
  if (status === "success") return "success";
  if (status === "failure") return "danger";
  if (status === "running") return "warning";
  return "muted";
}
/** 将 Task Run 的触发来源转换为用户可见标签。 */
function trigger_label(trigger: string): string {
  if (trigger === "manual") return "手动触发";
  if (trigger === "cron") return "Cron";
  if (trigger === "time") return "定时触发";
  return trigger;
}
/** 使用当前系统时区格式化 Task Run 时间。 */
function format_run_time(timestamp: number): string { return new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(new Date(timestamp)); }
/** 将毫秒耗时转换为紧凑的人类可读文本。 */
function format_duration(duration_ms: number): string {
  if (duration_ms < 1000) return `${Math.max(0, Math.round(duration_ms))} ms`;
  if (duration_ms < 60_000) return `${(duration_ms / 1000).toFixed(duration_ms < 10_000 ? 1 : 0)} 秒`;
  const minutes = Math.floor(duration_ms / 60_000);
  const seconds = Math.round((duration_ms % 60_000) / 1000);
  return seconds ? `${minutes} 分 ${seconds} 秒` : `${minutes} 分`;
}
/** 切换集合中的一个展开项，并保持不可变状态。 */
function toggle_key(current: Set<string>, key: string): Set<string> {
  const next = new Set(current);
  if (next.has(key)) next.delete(key);
  else next.add(key);
  return next;
}
