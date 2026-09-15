/** Workspace 管理页：MainView 承载正文，配置分区注册为右侧「Workspace」tab。 */
import { useMemo } from "react";
import { TbFolders } from "react-icons/tb";

import { use_desktop_selector } from "@/app/use_desktop";

import type { DesktopController, NavigationTarget } from "@/types/DesktopView";
import type { DesktopWorkspaceSummary } from "@common/types/DesktopApi";

import { WelcomeView } from "@/app/WelcomeView";

import { MainView } from "@/layouts/BayBar";

import { WorkspaceView } from "@/features/workspace/WorkspaceView";
import { WorkspaceFileView } from "@/features/workspace/WorkspaceFileView";
import { use_translation } from "@/locales/i18n";

/** Workspace 路由只订阅当前 Workspace 引用。 */
export function WorkspaceRouteMainView({ selection, controller, sidebar_collapsed }: { /** Workspace 导航目标。 */ selection: Extract<NavigationTarget, { kind: "workspace" | "workspace_file" }>; /** Desktop 稳定控制器。 */ controller: DesktopController; /** 全局 Sidebar 是否折叠。 */ sidebar_collapsed: boolean }) {
  const workspace = use_desktop_selector(controller.stores.catalog, (state) => state.workspaces.find((item) => item.workspace_id === selection.workspace_id));
  if (!workspace) return <WelcomeView />;
  return selection.kind === "workspace"
    ? <WorkspaceMainView workspace={workspace} controller={controller} sidebar_collapsed={sidebar_collapsed} />
    : <WorkspaceFileView workspace={workspace} relative_path={selection.relative_path} line={selection.line} />;
}

/** Workspace MainView：配置标签页在正文的入口被点击时构造并打开。 */
export function WorkspaceMainView({ workspace, controller, sidebar_collapsed }: { /** 当前 Workspace。 */ workspace: DesktopWorkspaceSummary; /** Desktop 稳定控制器。 */ controller: DesktopController; /** 全局 Sidebar 是否折叠。 */ sidebar_collapsed: boolean }) {
  return <MainView><WorkspaceView workspace={workspace} controller={controller} /></MainView>;
}

/** resources 命名空间的翻译函数。 */
function useTranslation_resources() {
  return use_translation("resources");
}
