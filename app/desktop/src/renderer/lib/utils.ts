/** Renderer 的 Tailwind class 合并工具，直接沿用 Duobox 实现。 */

import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

/** 合并条件 class，并消除相互冲突的 Tailwind utilities。 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
