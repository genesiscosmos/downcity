"use client";

/**
 * Downcity ToggleGroup 组件组。
 *
 * 关键说明（中文）
 * - 组件固定为互斥单选，多个项目共享唯一的移动激活层。
 * - 激活层依据真实项目尺寸定位，因此支持不同长度标签和纵向排列。
 * - 尺寸变化由 ResizeObserver 同步，不要求宿主应用手动刷新布局。
 */

import * as React from "react";
import { Toggle as TogglePrimitive } from "@base-ui/react/toggle";
import { ToggleGroup as ToggleGroupPrimitive } from "@base-ui/react/toggle-group";
import { type VariantProps } from "class-variance-authority";

import { cn } from "../lib/utils";
import type { DowncityToggleGroupProps } from "../types/components";
import { toggleVariants } from "./toggle";

const ToggleGroupContext = React.createContext<
  VariantProps<typeof toggleVariants> & {
    spacing?: number;
    orientation?: "horizontal" | "vertical";
  }
>({
  size: "default",
  variant: "default",
  spacing: 0,
  orientation: "horizontal",
});

const ToggleGroup = React.forwardRef<HTMLDivElement, Omit<DowncityToggleGroupProps, "ref">>(function ToggleGroup({
  className,
  variant,
  size,
  spacing = 0,
  orientation = "horizontal",
  children,
  ...props
}, ref) {
  const group_ref = React.useRef<HTMLDivElement | null>(null);
  const indicator_ref = React.useRef<HTMLSpanElement>(null);

  /** 同步外部引用，避免布局测量侵入宿主应用的 ref 所有权。 */
  const set_group_ref = React.useCallback((element: HTMLDivElement | null) => {
    group_ref.current = element;
    if (typeof ref === "function") ref(element);
    else if (ref) (ref as React.MutableRefObject<HTMLDivElement | null>).current = element;
  }, [ref]);

  /** 将唯一激活层移动到当前按下的项目位置。 */
  const update_indicator = React.useCallback(() => {
    const group_element = group_ref.current;
    const indicator_element = indicator_ref.current;
    if (!group_element || !indicator_element) return;

    const active_item = group_element.querySelector<HTMLElement>('[data-slot="toggle-group-item"][aria-pressed="true"]');
    if (!active_item) {
      indicator_element.style.opacity = "0";
      return;
    }

    indicator_element.style.width = `${active_item.offsetWidth}px`;
    indicator_element.style.height = `${active_item.offsetHeight}px`;
    indicator_element.style.transform = `translate3d(${active_item.offsetLeft}px, ${active_item.offsetTop}px, 0)`;
    indicator_element.style.opacity = "1";
  }, []);

  React.useLayoutEffect(() => {
    const group_element = group_ref.current;
    if (!group_element) return;

    update_indicator();
    const mutation_observer = new MutationObserver(update_indicator);
    mutation_observer.observe(group_element, {
      attributeFilter: ["aria-pressed", "data-state"],
      attributes: true,
      childList: true,
      subtree: true,
    });

    const resize_observer = new ResizeObserver(update_indicator);
    resize_observer.observe(group_element);
    group_element.querySelectorAll<HTMLElement>('[data-slot="toggle-group-item"]').forEach((item_element) => resize_observer.observe(item_element));

    return () => {
      mutation_observer.disconnect();
      resize_observer.disconnect();
    };
  }, [children, update_indicator]);

  return (
    <ToggleGroupPrimitive
      ref={set_group_ref}
      data-slot="toggle-group"
      data-variant={variant}
      data-size={size}
      data-spacing={spacing}
      data-orientation={orientation}
      style={spacing > 0 ? { gap: `${spacing}px` } : undefined}
      className={cn(
        "group/toggle-group relative isolate flex w-fit flex-row items-center rounded-full bg-control-surface p-1 data-vertical:flex-col data-vertical:items-stretch",
        className,
      )}
      {...props}
      multiple={false}
    >
      <span
        ref={indicator_ref}
        data-slot="toggle-group-indicator"
        aria-hidden="true"
        className="pointer-events-none absolute top-0 left-0 z-0 rounded-full bg-control-hover opacity-0 transition-[width,height,transform,opacity] duration-200 ease-out motion-reduce:transition-none"
      />
      <ToggleGroupContext.Provider value={{ variant, size, spacing, orientation }}>
        {children}
      </ToggleGroupContext.Provider>
    </ToggleGroupPrimitive>
  );
});

function ToggleGroupItem({
  className,
  children,
  variant = "default",
  size = "default",
  ...props
}: TogglePrimitive.Props & VariantProps<typeof toggleVariants>) {
  const context = React.useContext(ToggleGroupContext);
  const visible_children = React.Children.toArray(children).filter(Boolean);
  const is_icon_only = visible_children.length === 1 && React.isValidElement(visible_children[0]) && typeof visible_children[0].type !== "string";
  const resolved_size = context.size || size;
  const item_size_class = resolved_size === "sm" ? "h-6" : resolved_size === "lg" ? "h-8" : "h-7";
  const icon_size_class = resolved_size === "sm" ? "size-6 p-0" : resolved_size === "lg" ? "size-8 p-0" : "size-7 p-0";
  const item_padding_class = is_icon_only ? undefined : resolved_size === "sm" ? "px-1.5" : resolved_size === "lg" ? "px-2.5" : "px-2";

  return (
    <TogglePrimitive
      data-slot="toggle-group-item"
      data-icon-only={is_icon_only ? "true" : undefined}
      data-variant={context.variant || variant}
      data-size={context.size || size}
      data-spacing={context.spacing}
      className={cn(
        toggleVariants({
          variant: context.variant || variant,
          size: resolved_size,
        }),
        "relative z-10 shrink-0 rounded-full bg-transparent p-0 hover:bg-interaction-hover focus-visible:z-20 aria-pressed:bg-transparent data-[state=on]:bg-transparent",
        item_size_class,
        is_icon_only && icon_size_class,
        item_padding_class,
        className,
      )}
      {...props}
    >
      {children}
    </TogglePrimitive>
  );
}

export { ToggleGroup, ToggleGroupItem };
