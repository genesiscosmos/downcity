/** Badge 的公开展示契约；宿主通过语义变体和尺寸复用统一的标签排版。 */

import type { useRender } from "@base-ui/react/use-render";

/** 支持原生 span 属性与 Base UI render 组合能力的标签属性。 */
export type BadgeProps = useRender.ComponentProps<"span"> & {
  /** 标签的语义外观；secondary 为中性分类标签，default 为强调，其他变体对应错误、轮廓或轻量展示。 */
  variant?: "default" | "secondary" | "destructive" | "outline" | "ghost" | "link";
  /** 统一的排版尺寸；sm 最小高度 20px、文字行高 16px，default 最小高度 24px、文字行高 20px。 */
  size?: "sm" | "default";
};
