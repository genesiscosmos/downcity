/** 组合 Workspace Sidebar 的标题与目录树。 */

import { memo } from "react";
import { TbFolderPlus } from "react-icons/tb";
import { Button } from "@/components/ui/button";
import { use_desktop_selector } from "@/app/use_desktop";
import { use_translation } from "@/locales/i18n";
import type { DesktopController } from "@/types/DesktopView";
import { SidebarHeader } from "./SidebarHeader";
import { SidebarPanel } from "./SidebarPanel";
import { WorkspaceTree } from "./WorkspaceTree";

/** Workspace Sidebar 属性。 */
interface WorkspaceSidebarProps {
  /** Renderer 根状态与操作入口。 */
  controller: DesktopController;
  /** 打开创建 Workspace 表单。 */
  open_create_workspace(): void;
}

/** 读取 Workspace 目录状态并组合 Header 与 Tree。 */
export const WorkspaceSidebar = memo(function WorkspaceSidebar({ controller, open_create_workspace }: WorkspaceSidebarProps) {
  const translate = use_translation("resources");
  const workspaces = use_desktop_selector(controller.stores.catalog, (state) => state.workspaces);
  const selection = use_desktop_selector(controller.stores.navigation, (state) => state.selection);
  const loading = use_desktop_selector(controller.stores.settings, (state) => state.loading);
  const selected_workspace_id = selection?.kind === "workspace" || selection?.kind === "workspace_file" ? selection.workspace_id : undefined;

  return <SidebarPanel>
    <SidebarHeader title={translate("workspace.title")} actions={<Button size="icon" title={translate("workspace.create")} aria-label={translate("workspace.create")} onClick={open_create_workspace}><TbFolderPlus /></Button>} />
    <WorkspaceTree workspaces={workspaces} selected_workspace_id={selected_workspace_id} loading={loading} select_workspace={controller.actions.select_workspace} select_file={controller.actions.select_workspace_file} remove_workspace={controller.actions.remove_workspace} open_create_workspace={open_create_workspace} />
  </SidebarPanel>;
});
