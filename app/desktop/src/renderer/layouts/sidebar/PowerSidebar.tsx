/** 完整 Power Catalog 的列表 Sidebar。 */

import { cn } from "@/lib/utils";
import { PowerIcon } from "@/features/power/lib/PowerIcon";
import { memo } from "react";
import type { DesktopController } from "@/types/DesktopView";
import { use_desktop_selector } from "@/app/use_desktop";
import type { DesktopPowerSummary } from "@common/types/DesktopApi";
import { SidebarHeader } from "./SidebarHeader";
import { SidebarContent, SidebarPanel } from "./SidebarPanel";
import { use_translation } from "@/locales/i18n";

/** 始终列出全部 Power；点击后打开描述与配置详情。 */
export const PowerSidebar = memo(function PowerSidebar({ controller }: { /** 稳定控制器。 */ controller: DesktopController }) {
  const translate = use_translation("power");
  const selection = use_desktop_selector(controller.stores.navigation, (state) => state.selection);
  const powers = use_desktop_selector(controller.stores.catalog, (state) => state.powers);
  const selected_power_id = selection?.kind === "power" ? selection.power_id : "";
  return <SidebarPanel>
    <SidebarHeader title={translate("catalog")} />
    <SidebarContent>
      <div className="space-y-0.5">{powers.map((power) => <PowerListItem key={power.power_id} power={power} active={power.power_id === selected_power_id} select_power={controller.actions.select_power} />)}</div>
      {!powers.length ? <div className="px-3 py-8 text-center text-xs text-muted-foreground">{translate("empty")}</div> : null}
    </SidebarContent>
  </SidebarPanel>;
});

/** Power Catalog 中的紧凑条目。 */
function PowerListItem({ power, active, select_power }: {
  /** 当前 Power。 */ readonly power: DesktopPowerSummary;
  /** 当前是否打开该 Power 详情。 */ readonly active: boolean;
  /** 打开 Power 详情。 */ select_power(power_id: string): void;
}) {
  return <button type="button" onClick={() => select_power(power.power_id)} className={cn("group flex min-h-11 w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left outline-none transition-colors hover:bg-interaction-hover focus-visible:ring-2 focus-visible:ring-ring/30", active && "bg-interaction-selected")}>
    <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-surface-subtle text-muted-foreground"><PowerIcon power_id={power.power_id} icon_url={power.icon_url} /></span>
    <span className="min-w-0 flex-1"><span className="block truncate text-xs text-foreground">{power.title}</span><span className="mt-0.5 block truncate text-3xs text-muted-foreground">{power.description}</span></span>
  </button>;
}
