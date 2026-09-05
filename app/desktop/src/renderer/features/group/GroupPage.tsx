/** Desktop 按业务职责组织的页面与应用组件。 */
import { useState } from "react";

import { use_desktop_selector } from "@/app/use_desktop";

import type { DesktopController, NavigationTarget } from "@/types/DesktopView";
import type { DesktopGroupSummary } from "@common/types/DesktopApi";

import { WelcomeView } from "@/app/WelcomeView";

import { MainViewBayBarFrame } from "@/layouts/BayBar";
import { GroupConfigView, GroupInfoSidebar, type GroupEditorSection } from "@/features/group/GroupView";

/** Group 配置路由只订阅当前 Group。 */
export function GroupRouteMainView({ selection, controller, sidebar_collapsed }: { /** Group 配置导航目标。 */ selection: Extract<NavigationTarget, { kind: "group" }>; /** Desktop 稳定控制器。 */ controller: DesktopController; /** 全局 Sidebar 是否折叠。 */ sidebar_collapsed: boolean }) {
  const group = use_desktop_selector(controller.stores.catalog, (state) => state.groups_by_id[selection.group_id]);
  return group ? <GroupMainView key={`group:${group.group_id}`} group={group} controller={controller} sidebar_collapsed={sidebar_collapsed} /> : <WelcomeView />;
}

/** Group MainView 独立拥有配置 BayBar 的状态与编辑分区。 */
export function GroupMainView({ group, controller, sidebar_collapsed }: { /** 当前 Group。 */ group: DesktopGroupSummary; /** Desktop 稳定控制器。 */ controller: DesktopController; /** 全局 Sidebar 是否折叠。 */ sidebar_collapsed: boolean }) {
  const [section, set_section] = useState<GroupEditorSection>("model");
  const agents = use_desktop_selector(controller.stores.catalog, (state) => state.agents);
  return <MainViewBayBarFrame view_key={`group:${group.group_id}`} sidebar_collapsed={sidebar_collapsed} title={section === "model" ? "Model" : section === "instruction" ? "协作目标" : "成员"} baybar_content={<GroupInfoSidebar group={group} agents={agents} controller={controller} section={section} embedded close_sidebar={() => undefined} />}>
    {(open_baybar) => <GroupConfigView group={group} agents={agents} open_config={(next_section) => { set_section(next_section); open_baybar(); }} />}
  </MainViewBayBarFrame>;
}
