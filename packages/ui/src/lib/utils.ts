/**
 * Downcity UI SDK 通用工具。
 *
 * 关键说明（中文）
 * - `cn` 统一合并条件类名与 Tailwind 冲突类。
 * - 所有基础组件都应复用这个方法，避免类名覆盖顺序不一致。
 */

import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

// SDK 的主题声明了两档紧凑字号；必须注册为字号，避免被当作文字颜色合并掉。
const tw_merge = extendTailwindMerge({
  extend: {
    classGroups: {
      "font-size": [{ text: ["3xs", "2xs"] }],
    },
  },
});

export function cn(...inputs: ClassValue[]) {
  return tw_merge(clsx(inputs));
}
