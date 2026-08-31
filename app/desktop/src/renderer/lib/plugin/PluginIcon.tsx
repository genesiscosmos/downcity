/** Plugin 语义图标映射，供 Sidebar 与 Mainview Overview 共享。 */

import { useEffect, useState } from "react";
import {
  TbAddressBook,
  TbChecklist,
  TbDatabase,
  TbLayoutKanban,
  TbMessageCircle,
  TbPhoto,
  TbPlugConnected,
  TbSparkles,
  TbVolume,
  TbWorld,
} from "react-icons/tb";

/** 展示 Plugin 声明的图标，并在加载失败时回退到稳定语义图标。 */
export function PluginIcon({ plugin_id, icon_url, class_name = "size-4" }: {
  /** Plugin 的全局稳定 ID。 */
  plugin_id: string;
  /** Plugin 自己声明并由宿主解析的可选图标 URL。 */
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
  return render_fallback_plugin_icon(plugin_id, class_name);
}

/** 返回官方 Plugin 的稳定语义图标，未知 Plugin 使用通用连接图标。 */
function render_fallback_plugin_icon(plugin_id: string, class_name: string) {
  if (plugin_id === "chat") return <TbMessageCircle className={class_name} />;
  if (plugin_id === "contact") return <TbAddressBook className={class_name} />;
  if (plugin_id === "memory") return <TbDatabase className={class_name} />;
  if (plugin_id === "skill") return <TbSparkles className={class_name} />;
  if (plugin_id === "task") return <TbChecklist className={class_name} />;
  if (plugin_id === "workboard") return <TbLayoutKanban className={class_name} />;
  if (plugin_id === "web") return <TbWorld className={class_name} />;
  if (plugin_id === "image") return <TbPhoto className={class_name} />;
  if (plugin_id === "sound") return <TbVolume className={class_name} />;
  return <TbPlugConnected className={class_name} />;
}
