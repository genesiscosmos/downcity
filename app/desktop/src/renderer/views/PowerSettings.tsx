/** Power Catalog 详情页内的唯一 Config 面板。 */

import { useCallback } from "react";
import type { PowerJsonValue } from "@downcity/city/power";
import { BUILTIN_POWER_RENDERERS } from "@downcity/powers/renderers";
import { PowerRendererHost } from "@/features/power/lib/PowerRendererHost";
import type { DesktopActions } from "@/types/DesktopView";
import type { DesktopPowerDefinition, DesktopPowerSummary } from "@common/types/DesktopApi";

/** 直接渲染 City 为 Power 持有的唯一配置界面。 */
export function PowerConfigPanel({ controller, power, definition }: {
  /** Renderer 稳定操作集合。 */ readonly controller: DesktopActions;
  /** 当前 Power。 */ readonly power: DesktopPowerSummary;
  /** 已加载的完整 Power 定义。 */ readonly definition?: DesktopPowerDefinition;
}) {
  const invoke_power_action = controller.invoke_power_action;
  const invoke_config = useCallback(
    (action_id: string, input?: PowerJsonValue) => invoke_power_action(power.power_id, {
      surface: "config",
      action_id,
      ...(input !== undefined ? { input } : {}),
    }),
    [invoke_power_action, power.power_id],
  );
  const renderer = power.source === "builtin"
    ? BUILTIN_POWER_RENDERERS[power.power_id]
    : undefined;
  return <section className="overflow-hidden rounded-xl bg-surface-subtle p-4">
    <PowerRendererHost
      power_id={power.power_id}
      slot="config"
      capabilities={power}
      builtin_renderer={renderer}
      renderer_url={definition?.renderer_url}
      invoke_mainview={async () => { throw new Error("Config cannot invoke workspace actions"); }}
      invoke_config={invoke_config}
    />
  </section>;
}
