/**
 * Renderer 的 Tailwind class 合并工具。
 *
 * ## 为什么需要 `extendTailwindMerge`
 *
 * `cn` 底层是 tailwind-merge。它的合并规则来自一份**内置的 Tailwind 类名表**，
 * 只认得 Tailwind 官方的档位名。本应用的字号是一个 9 级阶梯
 * （`tokens.css` 的 `--text-3xs` … `--text-3xl` → `text-3xs` … `text-3xl`），
 * 其中 `3xs`/`2xs` 是 tailwind-merge 完全未知的名字，会走错分支：
 *
 * ```text
 * twMerge("text-3xs text-foreground") → "text-foreground"
 * ```
 *
 * 字号类被当成「与 `text-foreground` 冲突的颜色」删掉。这个失效**完全静默**：
 * TypeScript 检查不到（类名就是字符串）、Tailwind 也确实生成了 `.text-3xs` 规则、
 * 断言源码里类名常量的测试也全部通过，只有浏览器里字号悄悄退回 `inherit`。
 * 本应用为此吃过一次大亏：连续八轮「调整字号」在渲染上毫无效果。
 *
 * 因此这里把 9 个档位全部显式注册进 tailwind-merge 的 `font-size` 组。
 * 七级与 Tailwind 同名的档位其实已经在它的内置表里，重复注册是有意的：
 * 两处清单保持一致，新增档位时不会出现「一半已注册、一半没注册」的状态。
 *
 * ## 新增或改名档位时必须同步这里
 *
 * `tests/font_scale.test.ts` 会检查两处清单一致：`tokens.css` 定义了几级，
 * 这里就要注册几级、且名字逐一对应。少注册一级，那一级的字号会在**所有** `cn()`
 * 调用点被静默删除，只有恰好同时出现 `text-<颜色>` 时才会显现。
 */

import { type ClassValue, clsx } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

/**
 * 语义字号的 9 级阶梯，由小到大（不含 `text-` 前缀）。
 *
 * 必须与 `styles/tokens.css` 的 `--text-*` 一一对应且顺序一致，便于两处对照修改。
 * 其中 `xs` … `3xl` 七级的数值与 Tailwind 同名档位**完全相等**
 *（`3xs`/`2xs` 是 Tailwind 没有的名字），由 `tests/font_scale.test.ts`
 * 向 Tailwind 本尊比对保证。
 */
export const font_size_scale = ["3xs", "2xs", "xs", "sm", "base", "lg", "xl", "2xl", "3xl"] as const;

/** 已注册语义字号的 `twMerge`。 */
const tw_merge = extendTailwindMerge({
  extend: {
    classGroups: {
      // 关键：把自定义档位放进 font-size 组，而不是让它们落进颜色组。
      "font-size": [{ text: [...font_size_scale] }],
    },
  },
});

/** 合并条件 class，并消除相互冲突的 Tailwind utilities。 */
export function cn(...inputs: ClassValue[]) {
  return tw_merge(clsx(inputs));
}
