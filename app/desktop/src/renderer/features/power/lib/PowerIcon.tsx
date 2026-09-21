/** Power 语义图标映射，供 Sidebar、命令面板与 Chat 活动行共享。 */

import { useEffect, useState } from "react";
import { TbBuildingCommunity, TbChecklist, TbDatabase, TbMessageCircle, TbPhoto, TbPillFilled, TbPlugConnected, TbTerminal2, TbVolume, TbWorld } from "react-icons/tb";

/**
 * 展示 Power 声明的图标，并在加载失败时回退到稳定语义图标。
 *
 * 关键点（中文）：这是 Power 图标的唯一事实源。Sidebar、命令面板与 Chat 活动行都走它，
 * 因此同一个 Power 在三处长得一样。`city` 与 `shell` 虽然不在 Desktop Power catalog 里
 * （它们由 City 直接注册），但同样出现在活动行上，所以它们的语义图标登记在这里。
 */
export function PowerIcon({ power_id, icon_url, class_name = "size-4" }: {
  /** Power 的全局稳定 ID。 */
  power_id: string;
  /** Power 自己声明并由宿主解析的可选图标 URL。 */
  icon_url?: string;
  /** 图标尺寸和附加样式。 */
  class_name?: string;
}) {
  const [icon_failed, set_icon_failed] = useState(false);
  useEffect(() => set_icon_failed(false), [icon_url]);
  if (icon_url && !icon_failed) {
    return <img
      src={icon_url}
      alt=""
      className={`${class_name} object-contain`}
      onError={() => set_icon_failed(true)}
    />;
  }
  return render_fallback_power_icon(power_id, class_name);
}

/** 返回官方 Power 的稳定语义图标，未知 Power 使用通用连接图标。 */
function render_fallback_power_icon(power_id: string, class_name: string) {
  if (power_id === "chat") return <TbMessageCircle className={class_name} />;
  if (power_id === "memory") return <TbDatabase className={class_name} />;
  if (power_id === "skill") return <TbPillFilled className={class_name} />;
  if (power_id === "task") return <TbChecklist className={class_name} />;
  if (power_id === "web") return <TbWorld className={class_name} />;
  if (power_id === "image") return <TbPhoto className={class_name} />;
  if (power_id === "sound") return <TbVolume className={class_name} />;
  if (power_id === "city") return <TbBuildingCommunity className={class_name} />;
  if (power_id === "shell") return <TbTerminal2 className={class_name} />;
  return <TbPlugConnected className={class_name} />;
}
