/**
 * Homepage 界面语言上下文模块。
 *
 * Provider 只投影 Root 从 URL 解析出的当前语言，不复制或维护第二份可变状态。
 * Cookie 持久化与路由切换分别由 Root 和导航入口负责。
 */
import { createContext, useContext } from "react";
import type { InterfaceLocale, InterfaceLocaleProviderProps } from "@/types/interface-locale";

const INTERFACE_LOCALE_CONTEXT = createContext<InterfaceLocale | null>(null);

/** 向全站组件投影当前 URL 对应的界面语言。 */
export function InterfaceLocaleProvider({ locale, children }: InterfaceLocaleProviderProps) {
  return (
    <INTERFACE_LOCALE_CONTEXT.Provider value={locale}>
      {children}
    </INTERFACE_LOCALE_CONTEXT.Provider>
  );
}

/** 获取当前 URL 对应的界面语言。 */
export function use_interface_locale(): InterfaceLocale {
  const locale = useContext(INTERFACE_LOCALE_CONTEXT);

  if (locale === null) {
    throw new Error("use_interface_locale 必须在 InterfaceLocaleProvider 内使用");
  }

  return locale;
}
