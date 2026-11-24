/** Live Remote entry: owns the real connection lifecycle, independent of development fixtures. */
import { useState } from "react";
import { Remote_shell } from "./components/remote_shell";
import { use_remote } from "./lib/use_remote";
import type { Remote_locale } from "./types/remote";

/** 主题默认跟随系统，可在当前标签页内切换；语言默认跟随浏览器。 */
export function Remote_app() {
  const [locale, set_locale] = useState<Remote_locale>(() => navigator.language.startsWith("zh") ? "zh" : "en");
  const controller = use_remote(locale);
  return <Remote_shell controller={controller} locale={locale} on_locale_change={() => set_locale(locale === "en" ? "zh" : "en")} />;
}
