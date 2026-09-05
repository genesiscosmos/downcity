/** Desktop 按业务职责组织的页面与应用组件。 */
import { useState, type ReactNode } from "react";

import { use_desktop_selector } from "@/app/use_desktop";

import type { DesktopController } from "@/types/DesktopView";
import type { DesktopGroupSummary } from "@common/types/DesktopApi";

import { MainViewBayBarFrame } from "@/layouts/BayBar";
import { GroupInfoSidebar, type GroupEditorSection } from "@/features/group/GroupView";
import { use_translation } from "@/locales/i18n";

/** Group Chat 独立持有完整 Group 编辑 BayBar。 */
export function GroupChatMainView({ group, controller, sidebar_collapsed, view_key, children }: { /** 当前 Group。 */ group: DesktopGroupSummary; /** Desktop 稳定控制器。 */ controller: DesktopController; /** 全局 Sidebar 是否折叠。 */ sidebar_collapsed: boolean; /** 当前 Chat 的稳定标识。 */ view_key: string; /** 渲染 Chat 并接收编辑入口。 */ children(open_group_info: () => void): ReactNode }) {
  const translate = use_translation("resources");
  const [section, set_section] = useState<GroupEditorSection>("model");
  const agents = use_desktop_selector(controller.stores.catalog, (state) => state.agents);
  const titles: Record<GroupEditorSection, string> = { model: "Model", instruction: translate("group_details.goal"), members: translate("group_details.members") };
  const baybar_content = <div className="flex h-full min-h-0 flex-col"><nav className="flex shrink-0 gap-1 border-b border-border/45 p-2" aria-label={translate("editor.group_sections")}>{(["model", "instruction", "members"] as const).map((item) => <button key={item} type="button" onClick={() => set_section(item)} className={`rounded-md px-2 py-1 text-[0.6875rem] transition-colors duration-150 ${section === item ? "bg-interaction-selected text-foreground" : "text-muted-foreground hover:bg-interaction-hover hover:text-foreground"}`}>{titles[item]}</button>)}</nav><div className="min-h-0 flex-1 overflow-y-auto"><GroupInfoSidebar group={group} agents={agents} controller={controller} section={section} embedded close_sidebar={() => undefined} /></div></div>;
  return <MainViewBayBarFrame view_key={view_key} sidebar_collapsed={sidebar_collapsed} title={titles[section]} baybar_content={baybar_content}>{children}</MainViewBayBarFrame>;
}
