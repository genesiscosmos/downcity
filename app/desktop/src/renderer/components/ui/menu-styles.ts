/** Duobox 浮层菜单共享样式。 */

export const menu_surface_class_name =
  "z-50 min-w-52 overflow-hidden rounded-floating-surface border border-border bg-background p-1 text-popover-foreground outline-none";

export const menu_surface_motion_class_name =
  "data-open:animate-in data-closed:animate-out data-closed:fade-out-0 data-open:fade-in-0 data-[side=bottom]:slide-in-from-top-1 data-[side=left]:slide-in-from-right-1 data-[side=right]:slide-in-from-left-1 data-[side=top]:slide-in-from-bottom-1 duration-150";

export const menu_item_base_class_name =
  "relative flex w-full cursor-default select-none items-center gap-2.5 rounded-floating-item px-2 py-1.5 text-left text-xs text-foreground/80 outline-none transition-all duration-100 [&>svg]:size-3.5 [&>svg]:shrink-0";

export const menu_item_highlighted_class_name =
  "bg-interaction-selected text-foreground hover:bg-interaction-active focus:bg-interaction-active";

export const menu_item_interaction_class_name =
  "hover:bg-interaction-hover hover:text-foreground data-highlighted:bg-interaction-hover data-highlighted:text-foreground data-disabled:pointer-events-none data-disabled:opacity-50";

export const menu_label_class_name = "px-2 py-2 text-[11px] font-medium text-muted-foreground/60 select-none";
export const menu_separator_class_name = "-mx-1 my-1 h-px bg-divider";
export const menu_shortcut_class_name = "ml-auto shrink-0 text-xs tracking-widest opacity-60";
