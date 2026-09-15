/** Group 管理页：MainView 承载正文，配置分区注册为右侧「Group」tab。 */
import { useMemo } from "react";
import { TbUsers } from "react-icons/tb";

import { use_desktop_selector } from "@/app/use_desktop";

import type { DesktopController, NavigationTarget } from "@/types/DesktopView";
import type { DesktopGroupSummary } from "@common/types/DesktopApi";

import { WelcomeView } from "@/app/WelcomeView";

import { MainView } from "@/layouts/BayBar";

import { GroupConfigView } from "@/features/group/GroupView";
import { use_translation } from "@/locales/i18n";

/** Group 配置路由只订阅当前 Group。 */
export function GroupRouteMainView({ selection, controller, sidebar_collapsed }: { /** Group 配置导航目标。 */ selection: Extract<NavigationTarget, { kind: "group" }>; /** Desktop 稳定控制器。 */ controller: DesktopController; /** 全局 Sidebar 是否折叠。 */ sidebar_collapsed: boolean }) {
  const group = use_desktop_selector(controller.stores.catalog, (state) => state.groups_by_id[selection.group_id]);
  return group ? <GroupMainView key={`group:${group.group_id}`} group={group} controller={controller} sidebar_collapsed={sidebar_collapsed} /> : <WelcomeView />;
}

/** Group MainView：草稿状态在正文里持有，标签页在正文入口被点击时构造并打开。 */
export function GroupMainView({ group, controller, sidebar_collapsed }: { /** 当前 Group。 */ group: DesktopGroupSummary; /** Desktop 稳定控制器。 */ controller: DesktopController; /** 全局 Sidebar 是否折叠。 */ sidebar_collapsed: boolean }) {
  const agents = use_desktop_selector(controller.stores.catalog, (state) => state.agents);
  return <MainView><GroupConfigView group={group} agents={agents} controller={controller} /></MainView>;
}

/** resources 命名空间的翻译函数。 */
function useTranslation_resources() {
  return use_translation("resources");
}
