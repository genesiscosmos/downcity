/**
 * 模型控件的集中视觉契约。
 * 聊天工具栏、表单字段和目录行各自保留语义尺寸；仅组合 SDK 原语，
 * 不修改全局 Button/Input/Popover，也不依赖 Desktop 选择器或宿主 CSS。
 * 字段优先消费宿主的局部 field 令牌，独立使用时按背景派生同样的明暗反馈。
 */
import { cva } from "class-variance-authority";

export const chat_model_trigger_class_name = "h-6 w-auto min-w-0 gap-1 rounded-full border-none bg-transparent px-1.5 text-2xs font-normal leading-4 text-muted-foreground hover:bg-interaction-hover hover:text-foreground data-[popup-open]:bg-interaction-selected data-[popup-open]:text-foreground data-[popup-open]:hover:bg-interaction-active focus-visible:ring-2 focus-visible:ring-ring/30 [&_svg]:size-3.5";

export const model_field_surface_class_name = "rounded-control border-0 bg-[var(--field-background,color-mix(in_srgb,black_6%,var(--background)))] font-normal text-foreground shadow-none outline-none transition-colors hover:bg-[var(--field-hover,color-mix(in_srgb,black_10%,var(--background)))] focus-within:bg-[var(--field-focus,color-mix(in_srgb,black_14%,var(--background)))] data-[popup-open]:bg-[var(--field-focus,color-mix(in_srgb,black_14%,var(--background)))] disabled:cursor-not-allowed disabled:opacity-50";

export const model_field_trigger_variants = cva("inline-flex min-w-0 items-center gap-2 [&_svg]:size-4 [&_svg]:shrink-0", {
  variants: {
    control_size: {
      compact: "h-6 px-1.5 text-2xs leading-4",
      default: "h-8 px-2.5 text-xs leading-5",
      large: "h-10 px-3 text-sm leading-6",
    },
  },
  defaultVariants: { control_size: "compact" },
});

// 弹层使用主题背景，并在 Portal 内重新派生字段底色，避免继承页面卡片的底色。
export const model_popover_class_name = "rounded-surface border-border bg-background p-0 [--field-background:color-mix(in_srgb,black_6%,var(--background))] [--field-hover:color-mix(in_srgb,black_10%,var(--background))] [--field-focus:color-mix(in_srgb,black_14%,var(--background))]";
export const model_preview_class_name = "rounded-surface border-border bg-background text-foreground data-[side=right]:slide-in-from-left-1";

export const model_menu_item_class_name = "relative flex w-full cursor-default select-none items-center gap-2.5 rounded-item px-2 py-1.5 text-left text-xs text-foreground outline-none transition-all duration-100 [&>svg]:size-3.5 [&>svg]:shrink-0";
export const model_menu_selected_class_name = "bg-interaction-selected text-foreground hover:bg-interaction-active focus:bg-interaction-active";
export const model_menu_interaction_class_name = "hover:bg-interaction-hover hover:text-foreground data-highlighted:bg-interaction-hover data-highlighted:text-foreground data-disabled:pointer-events-none data-disabled:opacity-50";
export const model_field_item_class_name = "h-6 gap-1 rounded-item px-1.5 py-0 text-2xs leading-4";
export const model_field_selected_class_name = "bg-foreground/10 text-foreground hover:bg-foreground/10";
