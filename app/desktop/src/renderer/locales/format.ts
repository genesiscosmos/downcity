/** Desktop 与界面语言一致的日期、数字和金额格式化能力。 */

import type { DesktopLanguage } from "@common/types/DesktopLanguage";

/** 将 Desktop 语言转换为 Intl locale。 */
export function get_intl_locale(language: DesktopLanguage): string {
  return language === "zh" ? "zh-CN" : "en-US";
}

/** 使用当前语言格式化通用数字。 */
export function format_number(value: number, language: DesktopLanguage, options?: Intl.NumberFormatOptions): string {
  return new Intl.NumberFormat(get_intl_locale(language), options).format(value);
}

/** 使用当前语言格式化日期；无效输入保留原文。 */
export function format_date(value: string | number | Date, language: DesktopLanguage, options?: Intl.DateTimeFormatOptions): string {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : new Intl.DateTimeFormat(get_intl_locale(language), options).format(date);
}
