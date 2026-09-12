/** Group 管理页：MainView 组合内容与右侧「Group」域。 */
import { useMemo } from "react";

import { use_desktop_selector } from "@/app/use_desktop";

import type { DesktopController, NavigationTarget } from "@/types/DesktopView";
import type { DesktopGroupSummary } from "@common/types/DesktopApi";

import { WelcomeView } from "@/app/WelcomeView";

import { MainView, type BayBarDomain } from "@/layouts/BayBar";

import { GROUP_DOMAIN_ID, GROUP_EDITOR_SECTIONS, GroupConfigView, GroupEditorPanel } from "@/features/group/GroupView";
import { use_group_draft } from "@/features/group/lib/use_group_draft";
import { use_translation } from "@/locales/i18n";

/** Group 配置路由只订阅当前 Group。 */
export function GroupRouteMainView({ selection, controller, sidebar_collapsed }: { /** Group 配置导航目标。 */ selection: Extract<NavigationTarget, { kind: "group" }>; /** Desktop 稳定控制器。 */ controller: DesktopController; /** 全局 Sidebar 是否折叠。 */ sidebar_collapsed: boolean }) {
  const group = use_desktop_selector(controller.stores.catalog, (state) => state.groups_by_id[selection.group_id]);
  return group ? <GroupMainView key={`group:${group.group_id}`} group={group} controller={controller} sidebar_collapsed={sidebar_collapsed} /> : <WelcomeView />;
}

/** Group MainView：草稿状态在此持有，分区内容组装为右侧「Group」域。 */
export function GroupMainView({ group, controller, sidebar_collapsed }: { /** 当前 Group。 */ group: DesktopGroupSummary; /** Desktop 稳定控制器。 */ controller: DesktopController; /** 全局 Sidebar 是否折叠。 */ sidebar_collapsed: boolean }) {
  const translate_resources = useTranslation_resources();
  const agents = use_desktop_selector(controller.stores.catalog, (state) => state.agents);
  const { draft, update_draft } = use_group_draft(group, controller);
  const domains = useMemo<BayBarDomain[]>(() => [{
    id: GROUP_DOMAIN_ID,
    label: translate_resources("group.edit"),
    sections: GROUP_EDITOR_SECTIONS.map((item) => ({
      id: item.id,
      label: item.label_key ? translate_resources(item.label_key) : item.label ?? item.id,
      content: <GroupEditorPanel group={draft} agents={agents} controller={controller} section={item.id} set_group={update_draft} />,
    })),
  }], [agents, controller, draft, translate_resources, update_draft]);

  return <MainView view_key={`group:${group.group_id}`} domains={domains}>
    {() => <GroupConfigView group={group} agents={agents} />}
  </MainView>;
}

/** resources 命名空间的翻译函数。 */
function useTranslation_resources() {
  return use_translation("resources");
}
