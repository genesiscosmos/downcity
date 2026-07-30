/**
 * Homepage 界面语言解析模块。
 *
 * 显式语言路径是公开页面与 SEO 的稳定语言边界；无语言前缀的营销页则跟随
 * 用户在 i18next 中选择的语言，确保文案、导航和站内链接使用同一事实源。
 */
import type { SeoLocale } from "@/types/seo";

const localized_interface_roots = [
  "/",
  "/whitepaper",
  "/start",
  "/features",
  "/product",
  "/resources",
  "/community",
] as const;

/**
 * 解析当前界面应使用的语言。
 */
export function resolve_interface_locale(pathname: string, language: string): SeoLocale {
  if (pathname === "/zh" || pathname.startsWith("/zh/")) {
    return "zh";
  }

  if (pathname === "/en" || pathname.startsWith("/en/")) {
    return "en";
  }

  return language.toLowerCase().startsWith("zh") ? "zh" : "en";
}

/**
 * 为支持双语的营销页面生成目标语言路径。
 *
 * 未提供本地化版本的法律页面等路径保持不变，仅切换其界面翻译状态。
 */
export function create_interface_locale_path(pathname: string, locale: SeoLocale): string {
  const base_path = pathname.replace(/^\/(?:en|zh)(?=\/|$)/, "") || "/";
  const is_localized = localized_interface_roots.some((root) =>
    root === "/" ? base_path === "/" : base_path === root || base_path.startsWith(`${root}/`),
  );

  if (!is_localized) {
    return pathname;
  }

  if (locale === "en") {
    return base_path;
  }

  return base_path === "/" ? "/zh" : `/zh${base_path}`;
}
