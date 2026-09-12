/** Group Chat：MainView 组合内容与右侧「Group」域。 */
import { useMemo, type ReactNode } from "react";

import { use_desktop_selector } from "@/app/use_desktop";

import type { DesktopController } from "@/types/DesktopView";
import type { DesktopGroupSummary } from "@common/types/DesktopApi";

import { MainView, type BayBarDomain } from "@/layouts/BayBar";

import { GROUP_DOMAIN_ID, GROUP_EDITOR_SECTIONS, GroupEditorPanel } from "@/features/group/GroupView";
import { use_group_draft } from "@/features/group/lib/use_group_draft";
import { use_translation } from "@/locales/i18n";

/** Group Chat MainView 属性。 */
interface GroupChatMainViewProps {
  /** 当前 Group。 */
  group: DesktopGroupSummary;
  /** Desktop 稳定控制器。 */
  controller: DesktopController;
  /** 当前 Chat 的稳定标识，用于按会话记忆显示位置。 */
  view_key: string;
  /** 渲染 Chat 正文。 */
  children: ReactNode;
}

/** Group Chat 的右侧域。 */
export function GroupChatMainView({ group, controller, view_key, children }: GroupChatMainViewProps) {
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

  return <MainView view_key={view_key} domains={domains}>{() => children}</MainView>;
}

/** resources 命名空间的翻译函数。 */
function useTranslation_resources() {
  return use_translation("resources");
}
