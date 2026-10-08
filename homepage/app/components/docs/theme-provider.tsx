/**
 * 站点主题提供器。
 *
 * 统一拥有整站的明暗模式：用户在「浅色 / 深色 / 跟随系统」之间切换，选择持久化到
 * localStorage，并通过 `documentElement` 上的 `dark` 类驱动全局 CSS 变量。
 *
 * 为什么自己实现：原实现依赖文档框架的 `RootProvider`，其主题状态、持久化键与
 * class 切换时机都不由本站控制。收敛到本模块后，营销页、文档页与导航栏主题切换器
 * 共享同一份状态，且首屏闪白由内联引导脚本负责，不依赖 React 挂载时机。
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

/** 用户可选的主题模式，「system」表示跟随操作系统。 */
export type SiteThemeMode = "light" | "dark" | "system";

/** 实际生效的明暗外观。 */
export type SiteResolvedTheme = "light" | "dark";

/** 主题上下文值。 */
type SiteThemeContextValue = {
  /** 用户选择的主题模式。 */
  mode: SiteThemeMode;
  /** 当前实际生效的外观。 */
  resolved_theme: SiteResolvedTheme;
  /** 切换主题模式。 */
  set_mode: (mode: SiteThemeMode) => void;
};

/** localStorage 中保存主题模式的键，与首屏引导脚本保持一致。 */
export const site_theme_storage_key = "downcity-theme";

const site_theme_context = createContext<SiteThemeContextValue | null>(null);

/** 判断字符串是否为受支持的主题模式。 */
export function is_site_theme_mode(value: unknown): value is SiteThemeMode {
  return value === "light" || value === "dark" || value === "system";
}

/** 读取系统当前偏好的外观。 */
function read_system_theme(): SiteResolvedTheme {
  if (typeof window === "undefined" || !window.matchMedia) return "light";

  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

/**
 * 首屏主题引导脚本。
 *
 * 必须在 React 渲染前执行：预渲染 HTML 无法知道访问者的本地主题，若等到组件挂载
 * 再切换，深色用户会先看到一帧浅色页面。
 */
export const site_theme_bootstrap_script = `(() => {
  try {
    const stored = localStorage.getItem("${site_theme_storage_key}");
    const mode = stored === "light" || stored === "dark" || stored === "system" ? stored : "system";
    const prefers_dark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    const dark = mode === "dark" || (mode === "system" && prefers_dark);
    document.documentElement.classList.toggle("dark", dark);
  } catch {}
})();`;

/**
 * 提供站点主题状态。
 *
 * 服务端渲染阶段无法读取 localStorage，因此初始值固定为「跟随系统」，并在挂载后
 * 立即同步真实偏好；这不会造成视觉跳动，因为引导脚本已经设置好 class。
 */
export function SiteThemeProvider({ children }: { children: ReactNode }) {
  const [mode, set_mode_state] = useState<SiteThemeMode>("system");
  const [system_theme, set_system_theme] = useState<SiteResolvedTheme>("light");

  // 挂载后同步已保存的偏好与系统外观。
  useEffect(() => {
    const stored = window.localStorage.getItem(site_theme_storage_key);
    if (is_site_theme_mode(stored)) set_mode_state(stored);
    set_system_theme(read_system_theme());
  }, []);

  // 跟随系统时监听系统外观变化。
  useEffect(() => {
    const media_query = window.matchMedia("(prefers-color-scheme: dark)");
    const handle_change = () => set_system_theme(media_query.matches ? "dark" : "light");

    media_query.addEventListener("change", handle_change);

    return () => media_query.removeEventListener("change", handle_change);
  }, []);

  const resolved_theme: SiteResolvedTheme = mode === "system" ? system_theme : mode;

  // 主题结果统一写在 documentElement 上，所有 CSS 变量按该类切换。
  useEffect(() => {
    document.documentElement.classList.toggle("dark", resolved_theme === "dark");
  }, [resolved_theme]);

  const set_mode = useCallback((next_mode: SiteThemeMode) => {
    set_mode_state(next_mode);
    window.localStorage.setItem(site_theme_storage_key, next_mode);
  }, []);

  const value = useMemo<SiteThemeContextValue>(
    () => ({ mode, resolved_theme, set_mode }),
    [mode, resolved_theme, set_mode],
  );

  return <site_theme_context.Provider value={value}>{children}</site_theme_context.Provider>;
}

/**
 * 读取站点主题状态。
 *
 * 允许在 Provider 之外调用：营销页的部分静态区块不需要主题交互，返回兜底值可以
 * 避免为了一个图标而强行引入 Provider 依赖。
 */
export function use_site_theme(): SiteThemeContextValue {
  const context = useContext(site_theme_context);

  return (
    context ?? {
      mode: "system",
      resolved_theme: "light",
      set_mode: () => {},
    }
  );
}
