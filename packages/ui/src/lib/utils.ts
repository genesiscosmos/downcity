/**
 * Downcity UI SDK 通用工具。
 *
 * 关键说明（中文）
 * - `cn` 统一合并条件类名与 Tailwind 冲突类。
 * - 所有基础组件都应复用这个方法，避免类名覆盖顺序不一致。
 */

import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

// 注册 SDK 自定义字号和语义圆角，确保覆盖默认原语类时按同类规则合并。
const tw_merge = extendTailwindMerge({
  extend: {
    theme: { radius: ["control", "chip", "item", "surface"] },
    classGroups: {
      "font-size": [{ text: ["3xs", "2xs"] }],
    },
  },
});

export function cn(...inputs: ClassValue[]) {
  return tw_merge(clsx(inputs));
}
