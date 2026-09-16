/** Duobox 浮层菜单共享样式。 */

/**
 * 菜单表面：只负责圆角、描边、底色与**裁剪**。
 *
 * 这里刻意不带 padding、也不带滚动：内容再多也由内部滚动区处理（见下）。
 */
export const menu_surface_class_name =
  "z-50 min-w-52 overflow-hidden rounded-floating-surface border border-border bg-background text-popover-foreground outline-none";

/**
 * 菜单内容的滚动区：padding 与滚动都在这里。
 *
 * ## 为什么滚动不能放在带圆角的表面上
 *
 * 把 `overflow-y-auto` 加在圆角表面上时，滚动条属于该元素自身的绘制，浏览器只按矩形
 * 记账它在圆角处的溢出：滚动条会画到圆角外侧，顶部与底部明显戳出圆角（浅色主题下一眼可见）。
 * 圆角只对**后代**生效——`overflow-hidden` 的父层会把子层裁剪成圆角。
 *
 * 所以结构必须与 Select / Dialog 一致（那两个弹层一直是对的，只有下拉菜单破例）：
 *
 * ```
 * 表面：rounded + overflow-hidden        ← 只裁剪，不滚动、不带 padding
 *   └── 滚动区：overflow-y-auto + padding ← 真正滚动的内容
 * ```
 *
 * 反过来说：**任何时候都不要给 `DropdownMenuContent` / `Select` 的 className 传
 * `overflow-y-auto` 或 `max-h-*`**，那会把滚动重新放回圆角表面。要改高度上限请用
 * `scroll_class_name`。守卫见 tests/popup_scroll_region.test.ts。
 *
 * `--available-height` 由 Base UI 的 Positioner 给出（触发器到视口边缘的可用高度），
 * 因此菜单不会长到超出窗口；它未定义时回退到 20rem，行为与 Select 一致。
 */
export const menu_scroll_class_name =
  "max-h-[min(20rem,var(--available-height))] overflow-y-auto overscroll-contain p-1";

export const menu_surface_motion_class_name =
  "data-open:animate-in data-closed:animate-out data-closed:fade-out-0 data-open:fade-in-0 data-[side=bottom]:slide-in-from-top-1 data-[side=left]:slide-in-from-right-1 data-[side=right]:slide-in-from-left-1 data-[side=top]:slide-in-from-bottom-1 duration-150";

export const menu_item_base_class_name =
  "relative flex w-full cursor-default select-none items-center gap-2.5 rounded-floating-item px-2 py-1.5 text-left text-xs text-foreground outline-none transition-all duration-100 [&>svg]:size-3.5 [&>svg]:shrink-0";

export const menu_item_highlighted_class_name =
  "bg-interaction-selected text-foreground hover:bg-interaction-active focus:bg-interaction-active";

export const menu_item_interaction_class_name =
  "hover:bg-interaction-hover hover:text-foreground data-highlighted:bg-interaction-hover data-highlighted:text-foreground data-disabled:pointer-events-none data-disabled:opacity-50";

export const menu_label_class_name = "px-2 py-2 text-[0.6875rem] font-medium text-muted-foreground select-none";
export const menu_separator_class_name = "-mx-1 my-1 h-px bg-divider";
export const menu_shortcut_class_name = "ml-auto shrink-0 text-xs tracking-widest opacity-60";
