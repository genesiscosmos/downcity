/**
 * Homepage 界面语言类型模块。
 *
 * 界面语言是全站导航、营销页面和文档布局共享的产品状态，URL 是当前页面语言的
 * 唯一事实源，持久化 Cookie 只记录用户下次进入无前缀入口时的语言偏好。
 */
import type { ReactNode } from "react";

/** Homepage 当前支持的界面语言。 */
export type InterfaceLocale = "en" | "zh";

/** 界面语言 Provider 参数。 */
export type InterfaceLocaleProviderProps = {
  /** 从当前 URL 解析出的权威界面语言。 */
  locale: InterfaceLocale;
  /** 需要共享界面语言的页面内容。 */
  children: ReactNode;
};
