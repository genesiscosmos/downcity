/** 完整 Power Catalog 的列表 Sidebar。 */

import { TbComponents, TbLoader2 } from "react-icons/tb";
import { PowerIcon } from "@/features/power/lib/PowerIcon";
import { memo } from "react";
import type { DesktopController } from "@/types/DesktopView";
import { use_desktop_selector } from "@/app/use_desktop";
import type { DesktopPowerSummary } from "@common/types/DesktopApi";
import { SidebarHeader } from "./SidebarHeader";
import { SidebarContent, SidebarPanel } from "./SidebarPanel";
import { SidebarEmptyState } from "./SidebarEmptyState";
import { SidebarItem } from "./SidebarItem";
import { use_translation } from "@/locales/i18n";

/**
 * 始终列出全部 Power；点击后打开描述与配置详情。
 *
 * ## 加载中与「没有」必须分开
 *
 * Catalog 还没读到时，这里曾经直接落到空态上——用户看到的是「暂无 Power」，
 * 而事实是「还没读到」。两句话的含义完全相反，且前者会让人以为要重新安装 Power。
 * 现在读 Workspace 面板已经在用的那个 loading 切片，先显示加载态。
 *
 * ## 条目用 `agent` 变体 + 图标底块
 *
 * 行高与文字线与 Chat 主体行同一档（两者都是「一个带身份的条目，点开它」），
 * 但**行首多一个 28px 的圆角底块**（`leadingTile`）：Power 是一个能启用的**能力包**，
 * Chat 的主体是一个有头像的身份。这个底块是它们之间唯一的视觉差别，
 * 也是“这是产品概念、不是一条记录”的全部表达。
 *
 * 去掉它不会报错，只会让 Power 列表看起来像另一份 Chat 联系人列表——
 * 这是本轮重新设计时从历史实现里找回来的。
 */
export const PowerSidebar = memo(function PowerSidebar({ controller }: { /** 稳定控制器。 */ controller: DesktopController }) {
  const translate = use_translation("power");
  const translate_common = use_translation();
  const selection = use_desktop_selector(controller.stores.navigation, (state) => state.selection);
  const powers = use_desktop_selector(controller.stores.catalog, (state) => state.powers);
  const loading = use_desktop_selector(controller.stores.settings, (state) => state.loading);
  const selected_power_id = selection?.kind === "power" ? selection.power_id : "";
  return <SidebarPanel>
    <SidebarHeader title={translate("catalog")} />
    <SidebarContent class_name="space-y-0.5">
      {/* Power 条目与 Chat 主体行同档（`agent`），但行首是带底块的图标：
          它把「一个能启用的能力包」与「一个有头像的身份」区分开。 */}
      {powers.map((power) => <SidebarItem
        key={power.power_id}
        variant="agent"
        active={power.power_id === selected_power_id}
        leading={<PowerIcon power_id={power.power_id} icon_url={power.icon_url} />}
        leading_shape="tile"
        title={power.title}
        description={power.description}
        onSelect={() => controller.actions.select_power(power.power_id)}
      />)}
      {powers.length === 0 ? (loading
        ? <SidebarEmptyState icon={<TbLoader2 className="animate-spin" />} title={translate_common("state.loading")} />
        : <SidebarEmptyState icon={<TbComponents />} title={translate("empty")} />) : null}
    </SidebarContent>
  </SidebarPanel>;
});
