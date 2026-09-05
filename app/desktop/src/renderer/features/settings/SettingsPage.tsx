/** Desktop 按业务职责组织的页面与应用组件。 */
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { use_desktop_selector } from "@/app/use_desktop";

import type { DesktopController, SettingsSection } from "@/types/DesktopView";

import { SettingsView } from "@/features/settings/SettingsView";

import { MainViewBayBarFrame } from "@/layouts/BayBar";
import { use_translation } from "@/locales/i18n";

/** Settings MainView 仅在 General 页面拥有自己的 Global Env BayBar。 */
export function SettingsMainView({ controller, section, sidebar_collapsed }: { /** Desktop 稳定控制器。 */ controller: DesktopController; /** 当前设置分区。 */ section: SettingsSection; /** 全局 Sidebar 是否折叠。 */ sidebar_collapsed: boolean }) {
  if (section !== "general") return <SettingsView controller={controller} section={section} open_global_env={() => undefined} />;
  return <MainViewBayBarFrame view_key="settings:general" sidebar_collapsed={sidebar_collapsed} title="Global Env" baybar_content={<GlobalEnvEditor controller={controller} />}>
    {(open_baybar) => <SettingsView controller={controller} section={section} open_global_env={() => { void controller.actions.list_global_env(); open_baybar(); }} />}
  </MainViewBayBarFrame>;
}

/** BayBar 中的 Global Env 原文编辑器。 */
export function GlobalEnvEditor({ controller }: { controller: DesktopController }) {
  const translate = use_translation();
  const global_env = use_desktop_selector(controller.stores.settings, (state) => state.global_env);
  const [draft, set_draft] = useState(global_env);
  const [saving, set_saving] = useState(false);
  useEffect(() => set_draft(global_env), [global_env]);
  const save = async () => { set_saving(true); try { await controller.actions.update_global_env(draft); } finally { set_saving(false); } };
  return <div className="flex h-full min-h-0 flex-col p-3"><textarea className="min-h-0 flex-1 resize-none bg-transparent font-mono text-xs leading-6 text-foreground outline-none" value={draft} onChange={(event) => set_draft(event.target.value)} spellCheck={false} aria-label="Global Env" /><div className="flex justify-end pt-3"><Button variant="primary" disabled={saving || draft === global_env} onClick={() => void save()}>{translate(saving ? "actions.saving" : "actions.save")}</Button></div></div>;
}
