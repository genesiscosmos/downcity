/** 组合 Works 侧栏的标题、选择工具条与会话树。 */

import { memo, useCallback, useMemo, useState } from "react";
import { TbFolderPlus } from "react-icons/tb";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { use_desktop_selector } from "@/app/use_desktop";
import { use_translation } from "@/locales/i18n";
import type { DesktopController } from "@/types/DesktopView";
import { SidebarHeader } from "./SidebarHeader";
import { SidebarPanel } from "./SidebarPanel";
import { SessionSelectionBar } from "./SessionSelectionBar";
import { use_session_selection, type SessionSelectionTarget } from "./use_session_selection";
import { project_all_workspace_session_rows, project_default_agent_ids } from "./workspaceSessionRows";
import { WorkspaceSessionList } from "./WorkspaceSessionList";

/** Works 侧栏属性。 */
interface WorkspaceSidebarProps {
  /** Renderer 根状态与操作入口。 */
  controller: DesktopController;
  /** 打开创建 Workspace 表单。 */
  open_create_workspace(): void;
}

/**
 * 读取 Workspace、会话与 Group 状态，并组合 Header 与会话树。
 *
 * ## 为什么这一层订阅、列表层只收数据
 *
 * 会话树要四份数据（Workspace 目录、Session 目录、Group 目录、运行态），而它们都是整表：
 * 让每一行各自订阅会把整表广播到所有行。因此订阅留在这一层，向下只传投影所需的数据。
 *
 * ## 「当前项」有两级，各自表达
 *
 * - **Workspace 行**：任何带 `workspace_id` 的目标（Workspace 页、文件预览、会话、草稿、
 *   GroupSession）都算“我在这个 Workspace 里”。只看 `kind === "workspace"` 会漏掉最常见的
 *   那个情形：在 Works 侧栏里打开一条会话。
 * - **会话行**：只有会话目标且属于当前 Workspace 时才算当前。Agent Session 与 GroupSession
 *   都会标出当前位置——它们都是“这个 Workspace 里的一条对话”。
 *
 * 两者可以同时成立：在 Workspace 里打开了一条会话时，父行与子行都标出当前位置——
 * 层级里“我在哪一层”本来就是两个问题。
 *
 * ## 多选状态为什么在这一层
 *
 * 工具条在 Header、可勾选的行在列表里，两者都要读写同一份状态；放在任一侧都会让另一侧
 * 隔着组件树往回要。因此它挂在这里，Header 与列表都从它取（见 `use_session_selection`）。
 */
export const WorkspaceSidebar = memo(function WorkspaceSidebar({ controller, open_create_workspace }: WorkspaceSidebarProps) {
  const translate = use_translation("resources");
  const translate_navigation = use_translation("navigation");
  const translate_common = use_translation();
  const workspaces = use_desktop_selector(controller.stores.catalog, (state) => state.workspaces);
  const agents = use_desktop_selector(controller.stores.catalog, (state) => state.agents);
  const groups = use_desktop_selector(controller.stores.catalog, (state) => state.groups);
  const selection = use_desktop_selector(controller.stores.navigation, (state) => state.selection);
  const loading = use_desktop_selector(controller.stores.settings, (state) => state.loading);
  const sessions_by_workspace = use_desktop_selector(controller.stores.session, (state) => state.sessions_by_workspace);
  const hydrated = use_desktop_selector(controller.stores.session, (state) => state.hydrated);
  const chat_runtimes = use_desktop_selector(controller.stores.chat_stream, (state) => state.chat_runtime_by_session);
  // 只取 Group 的两片运行态：整表订阅会让流式消息也触发这棵树重渲染。
  const group_phase_by_group = use_desktop_selector(controller.stores.chat_stream, (state) => state.group_phase_by_group);
  // 选择器只取原切片（引用稳定），投影放 useMemo：在选择器里新建对象会让 useSyncExternalStore
  // 每次渲染都判定变化，直接造成无限重渲染。
  const group_interactions_by_group = use_desktop_selector(controller.stores.chat_stream, (state) => state.group_interactions_by_group);
  const group_interaction_counts = useMemo(() => group_interaction_counts_of(group_interactions_by_group), [group_interactions_by_group]);
  const notification_state = use_desktop_selector(controller.stores.notification, (state) => state);
  const selected_workspace_id = selection && "workspace_id" in selection ? selection.workspace_id : undefined;
  const selected_session_id = selection && (selection.kind === "session" || selection.kind === "group_session") ? selection.session_id : undefined;
  const [batch_pending, set_batch_pending] = useState(false);
  const [remove_confirm_open, set_remove_confirm_open] = useState(false);
  const [batch_error, set_batch_error] = useState("");

  /**
   * 全部会话行的投影，按 Workspace 索引。
   *
   * 列表渲染与多选的范围选择**必须看同一份**：范围取的是连续段，而顺序里含实时状态，
   * 两处各算一遍就会选中与用户看到的不一致的行。因此它只在这里算一次。
   */
  const rows_by_workspace = useMemo(() => project_all_workspace_session_rows({
    workspace_ids: workspaces.map((workspace) => workspace.workspace_id),
    sessions_by_workspace,
    groups,
    agents,
    chat_runtimes,
    group_phase_by_group,
    group_interaction_counts,
    notification_state,
  }), [agents, chat_runtimes, group_interaction_counts, group_phase_by_group, groups, notification_state, sessions_by_workspace, workspaces]);
  const default_agent_ids = useMemo(() => project_default_agent_ids({
    workspace_ids: workspaces.map((workspace) => workspace.workspace_id),
    sessions_by_workspace,
    agents,
  }), [agents, sessions_by_workspace, workspaces]);
  /** 全部可见会话的 key，按列表顺序；用于剔除失效选择。 */
  const ordered_keys = useMemo(
    () => [...rows_by_workspace.values()].flatMap((rows) => rows.map((row) => row.entry.key)),
    [rows_by_workspace],
  );
  /** key → 批量操作目标。 */
  const targets_by_key = useMemo(() => {
    const map = new Map<string, SessionSelectionTarget>();
    for (const rows of rows_by_workspace.values()) {
      for (const { entry } of rows) {
        map.set(entry.key, entry.kind === "agent"
          ? { key: entry.key, kind: "agent", workspace_id: entry.workspace_id, agent_id: entry.agent_id, session_id: entry.session.session_id }
          : { key: entry.key, kind: "group", workspace_id: entry.workspace_id, group_id: entry.group_id, session_id: entry.session.session_id });
      }
    }
    return map;
  }, [rows_by_workspace]);
  const session_selection = use_session_selection({ ordered_keys, targets_by_key });
  const has_group_sessions = session_selection.selected_targets.some((target) => target.kind === "group");

  /**
   * 在一个 Workspace 里打开空对话。
   *
   * `preserve_sidebar` 为真：新对话落在那个 Workspace 里，把用户切到 Agents 面板
   * 等于把他刚点的那棵树拿走。
   */
  const open_draft = useCallback((workspace_id: string, agent_id: string) => {
    void controller.actions.create_session(workspace_id, agent_id, true);
  }, [controller.actions]);

  /**
   * 批量归档选中的 Agent 会话。
   *
   * 逐条调用已有的 `archive_session`，而不是新写一个批量领域动作：那个动作带着导航回退、
   * 渲染缓存清理等副作用，重写一遍必然分叉。失败的条目收集起来一次性报告——
   * 中途停下会让用户不知道剩下几条到底动没动。
   */
  const archive_selected = useCallback(async () => {
    const targets = session_selection.selected_targets.filter((target) => target.kind === "agent");
    if (targets.length === 0 || batch_pending) return;
    set_batch_pending(true);
    set_batch_error("");
    const failed: string[] = [];
    for (const target of targets) {
      try {
        await controller.actions.archive_session(target.workspace_id, target.agent_id ?? "", target.session_id);
      } catch {
        failed.push(target.session_id);
      }
    }
    set_batch_pending(false);
    session_selection.exit();
    if (failed.length > 0) set_batch_error(translate_navigation("sidebar.batch_failed", { count: failed.length }));
  }, [batch_pending, controller.actions, session_selection, translate_navigation]);

  /** 批量删除选中的会话；两类会话都支持，执行前有确认。 */
  const remove_selected = useCallback(async () => {
    const targets = session_selection.selected_targets;
    if (targets.length === 0 || batch_pending) return;
    set_batch_pending(true);
    set_batch_error("");
    const failed: string[] = [];
    for (const target of targets) {
      try {
        if (target.kind === "agent") await controller.actions.remove_session(target.workspace_id, target.agent_id ?? "", target.session_id);
        else await controller.actions.remove_group_session(target.group_id ?? "", target.session_id);
      } catch {
        failed.push(target.session_id);
      }
    }
    set_batch_pending(false);
    set_remove_confirm_open(false);
    session_selection.exit();
    if (failed.length > 0) set_batch_error(translate_navigation("sidebar.batch_failed", { count: failed.length }));
  }, [batch_pending, controller.actions, session_selection, translate_navigation]);

  return <SidebarPanel>
    {session_selection.selection_mode
      ? <SessionSelectionBar
        selected_count={session_selection.selected_keys.length}
        has_group_sessions={has_group_sessions}
        pending={batch_pending}
        on_exit={session_selection.exit}
        on_archive={() => void archive_selected()}
        on_remove={() => { set_batch_error(""); set_remove_confirm_open(true); }}
      />
      : <SidebarHeader title={translate_navigation("views.workspaces")} actions={<Button size="icon" title={translate("workspace.create")} aria-label={translate("workspace.create")} onClick={open_create_workspace}><TbFolderPlus /></Button>} />}
    {/* 批量失败就地报告：用户此刻的注意力在这个面板上，错误出现在别处等于没提示。 */}
    {batch_error ? <div className="shrink-0 px-2 pb-1 text-2xs leading-4 text-destructive">{batch_error}</div> : null}
    <WorkspaceSessionList
      controller={controller}
      workspaces={workspaces}
      agents={agents}
      rows_by_workspace={rows_by_workspace}
      default_agent_ids={default_agent_ids}
      selected_workspace_id={selected_workspace_id}
      selected_session_id={selected_session_id}
      loading={loading}
      hydrated={hydrated}
      open_create_workspace={open_create_workspace}
      on_open_draft={open_draft}
      session_selection={session_selection}
    />
    {/* 批量删除是唯一不可逆的批量动作，因此有确认步骤；归档可逆，不打扰。 */}
    <Dialog open={remove_confirm_open} onOpenChange={(next_open) => { if (!batch_pending) set_remove_confirm_open(next_open); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{translate_navigation("sidebar.delete_selected_title", { count: session_selection.selected_keys.length })}</DialogTitle>
          <DialogDescription>{translate_navigation("sidebar.delete_selected_description")}</DialogDescription>
        </DialogHeader>
        <DialogBody>{batch_error ? <div className="text-xs text-destructive">{batch_error}</div> : null}</DialogBody>
        <DialogFooter>
          <Button disabled={batch_pending} onClick={() => set_remove_confirm_open(false)}>{translate_common("actions.cancel")}</Button>
          <Button variant="destructive" disabled={batch_pending} onClick={() => void remove_selected()}>
            {translate_navigation(batch_pending ? "sidebar.deleting" : "sidebar.permanent_delete")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </SidebarPanel>;
});

/**
 * 把「按 Group 缓存的待响应交互」投影成「按 Group 的条数」。
 *
 * 它必须跑在 `useMemo` 里，而不是写在选择器里：选择器每次返回新对象时，
 * `useSyncExternalStore` 会判定状态一直在变。列表只需要知道「有没有待响应」，
 * 而不是每条交互的内容，因此投影成数字后，交互内容的任何变化都不会改变它。
 */
function group_interaction_counts_of(interactions_by_group: Record<string, readonly unknown[]>): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const [group_id, interactions] of Object.entries(interactions_by_group)) {
    if (interactions.length > 0) counts[group_id] = interactions.length;
  }
  return counts;
}
