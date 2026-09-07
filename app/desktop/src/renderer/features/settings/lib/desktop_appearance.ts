/** Desktop 外观模式的纯判定规则。 */

import type { DesktopAppearanceMode } from "@common/types/DesktopApi";

/** 根据用户模式和系统偏好解析最终是否使用深色外观。 */
export function resolve_dark_appearance(appearance_mode: DesktopAppearanceMode, system_dark: boolean): boolean {
  if (appearance_mode === "dark") return true;
  if (appearance_mode === "light") return false;
  return system_dark;
}
