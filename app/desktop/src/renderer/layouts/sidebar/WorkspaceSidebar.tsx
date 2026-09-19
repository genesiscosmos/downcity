/** 组合 Workspace Sidebar 的标题与会话列表。 */

import { memo } from "react";
import { TbFolderPlus } from "react-icons/tb";
import { Button } from "@/components/ui/button";
import { use_desktop_selector } from "@/app/use_desktop";
import { use_translation } from "@/locales/i18n";
import type { DesktopController } from "@/types/DesktopView";
import { SidebarHeader } from "./SidebarHeader";
import { SidebarPanel } from "./SidebarPanel";
import { WorkspaceSessionList } from "./WorkspaceSessionList";

/** Workspace Sidebar 属性。 */
interface WorkspaceSidebarProps {
  /** Renderer 根状态与操作入口。 */
  controller: DesktopController;
  /** 打开创建 Workspace 表单。 */
  open_create_workspace(): void;
}

/**
 * 读取 Workspace 与会话目录状态，并组合 Header 与列表。
 *
 * ## 为什么这一层订阅、列表层只收数据
 *
 * 会话列表要三份数据（Workspace 目录、Session 目录、运行态），而它们都是整表：
 * 让每一行各自订阅会把整表广播到所有行。因此订阅留在这一层，向下只传投影所需的数据。
 *
 * ## 「当前项」有两级，各自表达
 *
 * - **Workspace 行**：任何带 `workspace_id` 的目标（Workspace 页、文件预览、会话、草稿）
 *   都算“我在这个 Workspace 里”。只看 `kind === "workspace"` 会漏掉最常见的那个情形：
 *   在 Workspace 侧栏里打开一条会话。
 * - **会话行**：只有 `kind === "session"` 且属于当前 Workspace 时才算当前。
 *
 * 两者可以同时成立：在 Workspace 里打开了一条会话时，父行与子行都标出当前位置——
 * 层级里“我在哪一层”本来就是两个问题。
 */
export const WorkspaceSidebar = memo(function WorkspaceSidebar({ controller, open_create_workspace }: WorkspaceSidebarProps) {
  const translate = use_translation("resources");
  const workspaces = use_desktop_selector(controller.stores.catalog, (state) => state.workspaces);
  const agents = use_desktop_selector(controller.stores.catalog, (state) => state.agents);
  const selection = use_desktop_selector(controller.stores.navigation, (state) => state.selection);
  const loading = use_desktop_selector(controller.stores.settings, (state) => state.loading);
  const sessions_by_workspace = use_desktop_selector(controller.stores.session, (state) => state.sessions_by_workspace);
  const hydrated = use_desktop_selector(controller.stores.session, (state) => state.hydrated);
  const chat_runtimes = use_desktop_selector(controller.stores.chat_stream, (state) => state.chat_runtime_by_session);
  const notification_state = use_desktop_selector(controller.stores.notification, (state) => state);
  const selected_workspace_id = selection && "workspace_id" in selection ? selection.workspace_id : undefined;
  const selected_session_id = selection?.kind === "session" ? selection.session_id : undefined;

  return <SidebarPanel>
    <SidebarHeader title={translate("workspace.title")} actions={<Button size="icon" title={translate("workspace.create")} aria-label={translate("workspace.create")} onClick={open_create_workspace}><TbFolderPlus /></Button>} />
    <WorkspaceSessionList
      controller={controller}
      workspaces={workspaces}
      agents={agents}
      selected_workspace_id={selected_workspace_id}
      selected_session_id={selected_session_id}
      loading={loading}
      hydrated={hydrated}
      sessions_by_workspace={sessions_by_workspace}
      chat_runtimes={chat_runtimes}
      notification_state={notification_state}
      open_create_workspace={open_create_workspace}
    />
  </SidebarPanel>;
});
