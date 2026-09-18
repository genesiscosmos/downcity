/**
 * Desktop Renderer 的国际化运行时。
 *
 * 翻译资源随应用静态打包，DesktopSettings.language 是语言选择的唯一持久化事实源。
 */

import i18n from "i18next";
import { initReactI18next, useTranslation as use_react_translation } from "react-i18next";
import type { DesktopLanguage } from "@common/types/DesktopLanguage";
import en_common from "./en/common.json";
import en_navigation from "./en/navigation.json";
import en_settings from "./en/settings.json";
import en_chat from "./en/chat.json";
import en_resources from "./en/resources.json";
import en_power from "./en/power.json";
import en_markdown from "./en/markdown.json";
import zh_common from "./zh/common.json";
import zh_navigation from "./zh/navigation.json";
import zh_settings from "./zh/settings.json";
import zh_chat from "./zh/chat.json";
import zh_resources from "./zh/resources.json";
import zh_power from "./zh/power.json";
import zh_markdown from "./zh/markdown.json";

/** Desktop 翻译资源的领域命名空间。 */
export type DesktopTranslationNamespace = "common" | "navigation" | "settings" | "chat" | "resources" | "power" | "markdown";

const resources = {
  en: { common: en_common, navigation: en_navigation, settings: en_settings, chat: en_chat, resources: en_resources, power: en_power, markdown: en_markdown },
  zh: { common: zh_common, navigation: zh_navigation, settings: zh_settings, chat: zh_chat, resources: zh_resources, power: zh_power, markdown: zh_markdown },
} as const;

void i18n.use(initReactI18next).init({
  resources,
  lng: "en",
  fallbackLng: "en",
  defaultNS: "common",
  ns: ["common", "navigation", "settings", "chat", "resources", "power", "markdown"],
  interpolation: { escapeValue: false },
  react: { useSuspense: false },
  returnNull: false,
  returnEmptyString: false,
});

/** 在 React 组件中读取指定领域的翻译函数。 */
export function use_translation(namespace: DesktopTranslationNamespace = "common") {
  const { t } = use_react_translation(namespace);
  return t;
}

/** 在 React 展示组件中读取已经生效的 Desktop 语言。 */
export function use_desktop_language(): DesktopLanguage {
  const { i18n: translation_runtime } = use_react_translation();
  return translation_runtime.resolvedLanguage === "zh" ? "zh" : "en";
}

/** 在非 React 展示边界读取当前语言的翻译文本。 */
export function translate(key: string, options?: Record<string, string | number | boolean | undefined>): string {
  return options ? i18n.t(key, options) : i18n.t(key);
}

/** 将持久化设置同步到翻译运行时与 HTML 文档语言。 */
export function apply_language(language: DesktopLanguage): void {
  document.documentElement.lang = language === "zh" ? "zh-CN" : "en";
  if (i18n.resolvedLanguage !== language) void i18n.changeLanguage(language);
}

export default i18n;
