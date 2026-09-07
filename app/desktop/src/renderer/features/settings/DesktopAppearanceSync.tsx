/** Desktop 外观设置到 Renderer 根文档的唯一同步边界。 */

import { useLayoutEffect } from "react";
import { use_desktop_selector } from "@/app/use_desktop";
import { resolve_dark_appearance } from "@/features/settings/lib/desktop_appearance";
import type { DesktopController } from "@/types/DesktopView";

const dark_mode_query = "(prefers-color-scheme: dark)";

/** 订阅外观设置，并同步颜色主题、明暗模式、系统主题变化与界面缩放。 */
export function DesktopAppearanceSync({ controller }: { /** Desktop 稳定控制器。 */ controller: DesktopController }) {
  const settings = use_desktop_selector(controller.stores.settings, (state) => state.settings);

  useLayoutEffect(() => {
    document.documentElement.dataset.theme = settings.color_theme;
    document.documentElement.style.fontSize = `${settings.ui_scale * 100}%`;
  }, [settings.color_theme, settings.ui_scale]);

  useLayoutEffect(() => {
    const media_query = window.matchMedia(dark_mode_query);
    const apply_mode = (system_dark: boolean) => {
      const dark = resolve_dark_appearance(settings.appearance_mode, system_dark);
      document.documentElement.classList.toggle("dark", dark);
      document.documentElement.style.colorScheme = dark ? "dark" : "light";
    };
    apply_mode(media_query.matches);
    if (settings.appearance_mode !== "system") return;
    const handle_change = (event: MediaQueryListEvent) => apply_mode(event.matches);
    media_query.addEventListener("change", handle_change);
    return () => media_query.removeEventListener("change", handle_change);
  }, [settings.appearance_mode]);

  return null;
}
