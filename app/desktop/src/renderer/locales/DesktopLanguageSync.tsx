/** Desktop 设置语言到 Renderer 国际化运行时的唯一同步边界。 */

import { useEffect } from "react";
import { use_desktop_selector } from "@/app/use_desktop";
import { apply_language } from "@/locales/i18n";
import type { DesktopController } from "@/types/DesktopView";

/** 订阅语言设置并同步 i18n 与 HTML lang。 */
export function DesktopLanguageSync({ controller }: { /** Desktop 稳定控制器。 */ controller: DesktopController }) {
  const language = use_desktop_selector(controller.stores.settings, (state) => state.settings.language);
  useEffect(() => apply_language(language), [language]);
  return null;
}
