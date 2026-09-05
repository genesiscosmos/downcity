/** Desktop 按业务职责组织的页面与应用组件。 */
import { useState } from "react";

import { use_desktop_selector } from "@/app/use_desktop";

import type { DesktopController, NavigationTarget } from "@/types/DesktopView";
import type { DesktopWorkspaceSummary } from "@common/types/DesktopApi";

import { WelcomeView } from "@/app/WelcomeView";

import { WorkspaceInfoSidebar, WorkspaceView, type WorkspaceEditorField } from "@/features/workspace/WorkspaceView";
import { WorkspaceFileView } from "@/features/workspace/WorkspaceFileView";
import { MainViewBayBarFrame } from "@/layouts/BayBar";
import { use_translation } from "@/locales/i18n";

/** Workspace 路由只订阅当前 Workspace 引用。 */
export function WorkspaceRouteMainView({ selection, controller, sidebar_collapsed }: { /** Workspace 导航目标。 */ selection: Extract<NavigationTarget, { kind: "workspace" | "workspace_file" }>; /** Desktop 稳定控制器。 */ controller: DesktopController; /** 全局 Sidebar 是否折叠。 */ sidebar_collapsed: boolean }) {
  const workspace = use_desktop_selector(controller.stores.catalog, (state) => state.workspaces.find((item) => item.workspace_id === selection.workspace_id));
  if (!workspace) return <WelcomeView />;
  return selection.kind === "workspace"
    ? <WorkspaceMainView workspace={workspace} controller={controller} sidebar_collapsed={sidebar_collapsed} />
    : <WorkspaceFileView workspace={workspace} relative_path={selection.relative_path} />;
}

/** Workspace MainView 独立拥有配置 BayBar 的分区编辑侧栏。 */
export function WorkspaceMainView({ workspace, controller, sidebar_collapsed }: { /** 当前 Workspace。 */ workspace: DesktopWorkspaceSummary; /** Desktop 稳定控制器。 */ controller: DesktopController; /** 全局 Sidebar 是否折叠。 */ sidebar_collapsed: boolean }) {
  const translate_resources = use_translation("resources");
  const [section, set_section] = useState<WorkspaceEditorField>("identity");
  const titles: Record<WorkspaceEditorField, string> = { identity: translate_resources("workspace.identity"), readme: "README.md" };
  const baybar_content = <div className="flex h-full min-h-0 flex-col"><nav className="flex shrink-0 gap-1 border-b border-border/45 p-2" aria-label={translate_resources("workspace.edit_sections")}>{(["identity", "readme"] as const).map((item) => <button key={item} type="button" onClick={() => set_section(item)} className={`rounded-md px-2 py-1 text-[0.6875rem] transition-colors duration-150 ${section === item ? "bg-interaction-selected text-foreground" : "text-muted-foreground hover:bg-interaction-hover hover:text-foreground"}`}>{titles[item]}</button>)}</nav><div className="min-h-0 flex-1 overflow-y-auto"><WorkspaceInfoSidebar workspace={workspace} controller={controller.actions} section={section} embedded close_sidebar={() => undefined} /></div></div>;
  return <MainViewBayBarFrame view_key={`workspace:${workspace.workspace_id}`} sidebar_collapsed={sidebar_collapsed} title={titles[section]} baybar_content={baybar_content}>
    {(open_baybar) => <WorkspaceView workspace={workspace} open_editor={(field) => { set_section(field); open_baybar(); }} />}
  </MainViewBayBarFrame>;
}
