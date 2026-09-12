/** Settings MainView：General 分区在右侧提供「Global Env」域。 */
import { useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { use_desktop_selector } from "@/app/use_desktop";

import type { DesktopController, SettingsSection } from "@/types/DesktopView";

import { SettingsView } from "@/features/settings/SettingsView";

import { MainView, use_baybar_open, type BayBarDomain } from "@/layouts/BayBar";
import { use_translation } from "@/locales/i18n";

/** Global Env 域与分区的稳定标识。 */
const GLOBAL_ENV_DOMAIN_ID = "global-env";

/**
 * Settings MainView：仅 General 分区提供 Global Env 域。
 * 其他分区不提供域，右侧整体消失，折叠按钮也不出现。
 */
export function SettingsMainView({ controller, section, sidebar_collapsed }: { /** Desktop 稳定控制器。 */ controller: DesktopController; /** 当前设置分区。 */ section: SettingsSection; /** 全局 Sidebar 是否折叠。 */ sidebar_collapsed: boolean }) {
  const domains = useMemo<BayBarDomain[]>(() => section === "general" ? [{
    id: GLOBAL_ENV_DOMAIN_ID,
    label: "Global Env",
    sections: [{ id: "editor", label: "Global Env", content: <GlobalEnvEditor controller={controller} /> }],
  }] : [], [controller, section]);

  return <MainView view_key={`settings:${section}`} domains={domains}>
    {() => <SettingsContent controller={controller} section={section} />}
  </MainView>;
}

/** 正文：General 分区的入口通过 BayBar 打开右侧编辑器。 */
function SettingsContent({ controller, section }: { controller: DesktopController; section: SettingsSection }) {
  const open_baybar = use_baybar_open();
  return <SettingsView
    controller={controller}
    section={section}
    open_global_env={() => { void controller.actions.list_global_env(); open_baybar(GLOBAL_ENV_DOMAIN_ID); }}
  />;
}

/** 面板中的 Global Env 原文编辑器。 */
export function GlobalEnvEditor({ controller }: { controller: DesktopController }) {
  const translate = use_translation();
  const global_env = use_desktop_selector(controller.stores.settings, (state) => state.global_env);
  const [draft, set_draft] = useState(global_env);
  const [saving, set_saving] = useState(false);
  useEffect(() => set_draft(global_env), [global_env]);
  const save = async () => { set_saving(true); try { await controller.actions.update_global_env(draft); } finally { set_saving(false); } };
  return <div className="flex h-full min-h-0 flex-col p-3"><textarea className="min-h-0 flex-1 resize-none bg-transparent font-mono text-xs leading-6 text-foreground outline-none" value={draft} onChange={(event) => set_draft(event.target.value)} spellCheck={false} aria-label="Global Env" /><div className="flex justify-end pt-3"><Button variant="primary" disabled={saving || draft === global_env} onClick={() => void save()}>{translate(saving ? "actions.saving" : "actions.save")}</Button></div></div>;
}
