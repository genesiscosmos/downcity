/** Workspace 管理页：MainView 组合内容与右侧「Workspace」域。 */
import { useMemo } from "react";

import { use_desktop_selector } from "@/app/use_desktop";

import type { DesktopController, NavigationTarget } from "@/types/DesktopView";
import type { DesktopWorkspaceSummary } from "@common/types/DesktopApi";

import { WelcomeView } from "@/app/WelcomeView";

import { MainView, type BayBarDomain } from "@/layouts/BayBar";

import { WORKSPACE_DOMAIN_ID, WORKSPACE_EDITOR_SECTIONS, WorkspaceEditorPanel, WorkspaceView } from "@/features/workspace/WorkspaceView";
import { WorkspaceFileView } from "@/features/workspace/WorkspaceFileView";
import { use_translation } from "@/locales/i18n";

/** Workspace 路由只订阅当前 Workspace 引用。 */
export function WorkspaceRouteMainView({ selection, controller, sidebar_collapsed }: { /** Workspace 导航目标。 */ selection: Extract<NavigationTarget, { kind: "workspace" | "workspace_file" }>; /** Desktop 稳定控制器。 */ controller: DesktopController; /** 全局 Sidebar 是否折叠。 */ sidebar_collapsed: boolean }) {
  const workspace = use_desktop_selector(controller.stores.catalog, (state) => state.workspaces.find((item) => item.workspace_id === selection.workspace_id));
  if (!workspace) return <WelcomeView />;
  return selection.kind === "workspace"
    ? <WorkspaceMainView workspace={workspace} controller={controller} sidebar_collapsed={sidebar_collapsed} />
    : <WorkspaceFileView workspace={workspace} relative_path={selection.relative_path} />;
}

/** Workspace MainView：配置分区组装为右侧「Workspace」域。 */
export function WorkspaceMainView({ workspace, controller, sidebar_collapsed }: { /** 当前 Workspace。 */ workspace: DesktopWorkspaceSummary; /** Desktop 稳定控制器。 */ controller: DesktopController; /** 全局 Sidebar 是否折叠。 */ sidebar_collapsed: boolean }) {
  const translate_resources = useTranslation_resources();
  const domains = useMemo<BayBarDomain[]>(() => [{
    id: WORKSPACE_DOMAIN_ID,
    label: translate_resources("workspace.edit"),
    sections: WORKSPACE_EDITOR_SECTIONS.map((item) => ({
      id: item.id,
      label: item.label_key ? translate_resources(item.label_key) : item.label ?? item.id,
      content: <WorkspaceEditorPanel workspace={workspace} controller={controller.actions} section={item.id} />,
    })),
  }], [controller.actions, translate_resources, workspace]);

  return <MainView view_key={`workspace:${workspace.workspace_id}`} domains={domains}>
    {() => <WorkspaceView workspace={workspace} />}
  </MainView>;
}

/** resources 命名空间的翻译函数。 */
function useTranslation_resources() {
  return use_translation("resources");
}
