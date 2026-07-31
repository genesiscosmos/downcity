/**
 * Homepage 界面语言路径与持久化策略模块。
 *
 * 设计约束：
 * 1. URL 决定当前页面语言，Cookie 不能覆盖显式语言路径。
 * 2. Cookie 只保存用户偏好，并在静态页面首次执行时将无前缀营销入口导向中文路径。
 * 3. 英文营销页保持无前缀 URL，中文营销页统一使用 `/zh` 前缀。
 */
import type { InterfaceLocale } from "@/types/interface-locale";

export const interface_locale_cookie_name = "downcity-locale";

const interface_locale_cookie_max_age = 60 * 60 * 24 * 365;

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
 * 从当前路径解析界面语言。
 *
 * 中文营销页和文档页使用 `/zh` 前缀；其余公开页面默认使用英文。
 */
export function get_path_interface_locale(pathname: string): InterfaceLocale {
  return pathname === "/zh" || pathname.startsWith("/zh/") ? "zh" : "en";
}

/** 判断路径是否属于支持中英文对应版本的营销页面。 */
export function is_localized_interface_path(pathname: string): boolean {
  const base_path = pathname.replace(/^\/(?:en|zh)(?=\/|$)/, "") || "/";

  return localized_interface_roots.some((root) =>
    root === "/" ? base_path === "/" : base_path === root || base_path.startsWith(`${root}/`),
  );
}

/**
 * 判断当前路径是否可以更新用户语言偏好。
 *
 * 没有语言版本的法律页、API 与系统入口不能把已有偏好意外重置为英文。
 */
export function should_persist_interface_locale(pathname: string): boolean {
  const has_explicit_locale =
    pathname === "/en" ||
    pathname === "/zh" ||
    pathname.startsWith("/en/") ||
    pathname.startsWith("/zh/");

  return has_explicit_locale || is_localized_interface_path(pathname);
}

/**
 * 为支持双语的营销页面生成目标语言路径。
 *
 * 未提供本地化版本的法律页面等路径保持不变，只保留当前公开 URL。
 */
export function create_interface_locale_path(pathname: string, locale: InterfaceLocale): string {
  const base_path = pathname.replace(/^\/(?:en|zh)(?=\/|$)/, "") || "/";

  if (!is_localized_interface_path(pathname)) {
    return pathname;
  }

  if (locale === "en") {
    return base_path;
  }

  return base_path === "/" ? "/zh" : `/zh${base_path}`;
}

/** 生成浏览器可持久保存一年的语言偏好 Cookie。 */
export function serialize_interface_locale_cookie(locale: InterfaceLocale): string {
  return `${interface_locale_cookie_name}=${locale}; Path=/; Max-Age=${interface_locale_cookie_max_age}; SameSite=Lax`;
}

/** 在浏览器中持久保存用户主动选择的语言。 */
export function persist_interface_locale(locale: InterfaceLocale): void {
  if (typeof document === "undefined") {
    return;
  }

  document.cookie = serialize_interface_locale_cookie(locale);
}

/**
 * 静态页面语言引导脚本。
 *
 * Cloudflare Pages 直接返回预渲染 HTML，脚本必须在 React 渲染前读取 Cookie，
 * 才能避免中文偏好用户先看到英文页面再发生客户端切换。
 */
export const interface_locale_bootstrap_script = `(() => {
  try {
    const locale_cookie = document.cookie
      .split("; ")
      .find((entry) => entry.startsWith("${interface_locale_cookie_name}="));
    const preferred_locale = locale_cookie?.split("=")[1];

    if (preferred_locale !== "zh") return;

    const pathname = window.location.pathname;
    const localized_roots = ${JSON.stringify(localized_interface_roots)};
    const is_localized_path = localized_roots.some((root) =>
      root === "/"
        ? pathname === "/"
        : pathname === root || pathname.startsWith(root + "/"),
    );

    if (!is_localized_path) return;

    const target_path = pathname === "/" ? "/zh" : "/zh" + pathname;
    window.location.replace(target_path + window.location.search + window.location.hash);
  } catch {}
})();`;
