/**
 * 展示站主题状态与根节点同步逻辑。
 *
 * 颜色主题和明暗外观彼此独立：前者决定语义 token 的色调，后者决定浅色或深色 token。
 */

import { useEffect, useState } from "react";

import type { ShowcaseColorMode, ShowcaseThemeId } from "../types/components.js";

const theme_storage_key = "downcity-ui-theme";
const color_mode_storage_key = "downcity-ui-color-mode";
const default_theme_id: ShowcaseThemeId = "neutral";
const default_color_mode: ShowcaseColorMode = "system";

/** 主题选择器展示所需的稳定主题信息。 */
export const theme_options: readonly { id: ShowcaseThemeId; label: string; swatch_class_name: string }[] = [
  { id: "neutral", label: "Neutral", swatch_class_name: "bg-[var(--theme-preview-neutral)]" },
  { id: "zinc", label: "Zinc", swatch_class_name: "bg-[var(--theme-preview-zinc)]" },
  { id: "slate", label: "Slate", swatch_class_name: "bg-[var(--theme-preview-slate)]" },
  { id: "stone", label: "Stone", swatch_class_name: "bg-[var(--theme-preview-stone)]" },
  { id: "blue", label: "Blue", swatch_class_name: "bg-[var(--theme-preview-blue)]" },
];

/** 从持久化值读取合法主题，非法值回退为默认主题。 */
function read_theme_id(): ShowcaseThemeId {
  const stored_value = window.localStorage.getItem(theme_storage_key);
  return theme_options.some((option) => option.id === stored_value) ? stored_value as ShowcaseThemeId : default_theme_id;
}

/** 从持久化值读取合法外观偏好，非法值回退为系统偏好。 */
function read_color_mode(): ShowcaseColorMode {
  const stored_value = window.localStorage.getItem(color_mode_storage_key);
  return stored_value === "light" || stored_value === "dark" || stored_value === "system" ? stored_value : default_color_mode;
}

/** 返回当前外观偏好对应的实际明暗模式。 */
function resolve_color_mode(color_mode: ShowcaseColorMode): "light" | "dark" {
  if (color_mode !== "system") return color_mode;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

/** 维护并持久化主题选择，具体主题由 ThemeContainer 应用。 */
export function use_theme() {
  const [theme_id, set_theme_id] = useState<ShowcaseThemeId>(() => read_theme_id());
  const [color_mode, set_color_mode] = useState<ShowcaseColorMode>(() => read_color_mode());
  const [resolved_color_mode, set_resolved_color_mode] = useState<"light" | "dark">(() => resolve_color_mode(read_color_mode()));

  useEffect(() => {
    const media_query = window.matchMedia("(prefers-color-scheme: dark)");
    const sync_color_mode = () => set_resolved_color_mode(resolve_color_mode(color_mode));
    sync_color_mode();
    media_query.addEventListener("change", sync_color_mode);
    return () => media_query.removeEventListener("change", sync_color_mode);
  }, [color_mode]);

  useEffect(() => {
    window.localStorage.setItem(theme_storage_key, theme_id);
    window.localStorage.setItem(color_mode_storage_key, color_mode);
  }, [theme_id, color_mode, resolved_color_mode]);

  return { theme_id, set_theme_id, color_mode, set_color_mode, resolved_color_mode };
}
