/** 设置页使用的可键盘操作分段选择控件。 */

import { useCallback, useLayoutEffect, useRef, type KeyboardEvent } from "react";
import { cn } from "@/lib/utils";

/** 分段选择项。 */
export interface SegmentedControlOption<Value extends string> {
  /** 选项稳定值。 */
  value: Value;
  /** 选项展示名称。 */
  label: string;
  /** 是否禁止选择。 */
  disabled?: boolean;
}

/** 分段选择控件属性。 */
interface SegmentedControlProps<Value extends string> {
  /** 当前选中值。 */
  value: Value;
  /** 全部可选项。 */
  options: readonly SegmentedControlOption<Value>[];
  /** 选中项变化回调。 */
  on_value_change(value: Value): void;
  /** 辅助功能名称。 */
  aria_label: string;
  /** 附加样式。 */
  class_name?: string;
}

/** 与 Duobox 设置页一致的紧凑分段控件。 */
export function SegmentedControl<const Value extends string>(props: SegmentedControlProps<Value>) {
  const group_ref = useRef<HTMLDivElement>(null);
  const indicator_ref = useRef<HTMLSpanElement>(null);
  const update_indicator = useCallback(() => {
    const group = group_ref.current;
    const indicator = indicator_ref.current;
    if (!group || !indicator) return;
    const active_option = group.querySelector<HTMLElement>('[data-segmented-option][aria-checked="true"]');
    if (!active_option) {
      indicator.style.opacity = "0";
      return;
    }
    indicator.style.width = `${active_option.offsetWidth}px`;
    indicator.style.height = `${active_option.offsetHeight}px`;
    indicator.style.transform = `translate3d(${active_option.offsetLeft}px, ${active_option.offsetTop}px, 0)`;
    indicator.style.opacity = "1";
  }, []);

  useLayoutEffect(() => {
    update_indicator();
    const group = group_ref.current;
    if (!group) return;
    const resize_observer = new ResizeObserver(update_indicator);
    resize_observer.observe(group);
    group.querySelectorAll<HTMLElement>("[data-segmented-option]").forEach((option) => resize_observer.observe(option));
    return () => resize_observer.disconnect();
  }, [props.value, update_indicator]);

  const handle_key_down = (event: KeyboardEvent<HTMLButtonElement>, current_value: Value) => {
    const enabled_options = props.options.filter((option) => !option.disabled);
    const current_index = enabled_options.findIndex((option) => option.value === current_value);
    if (current_index === -1) return;
    let next_index: number | null = null;
    if (event.key === "ArrowLeft" || event.key === "ArrowUp") next_index = (current_index - 1 + enabled_options.length) % enabled_options.length;
    if (event.key === "ArrowRight" || event.key === "ArrowDown") next_index = (current_index + 1) % enabled_options.length;
    if (event.key === "Home") next_index = 0;
    if (event.key === "End") next_index = enabled_options.length - 1;
    if (next_index === null) return;
    event.preventDefault();
    const option = enabled_options[next_index];
    props.on_value_change(option.value);
    group_ref.current?.querySelector<HTMLButtonElement>(`[data-segmented-option="${CSS.escape(option.value)}"]`)?.focus();
  };
  return <div ref={group_ref} role="radiogroup" aria-label={props.aria_label} className={cn("relative isolate inline-flex h-8 max-w-full items-center rounded-full bg-muted-foreground/10 p-1", props.class_name)}>
    <span ref={indicator_ref} aria-hidden="true" className="pointer-events-none absolute left-0 top-0 z-0 rounded-full bg-control-hover opacity-0 transition-[width,height,transform,opacity] duration-200 ease-out motion-reduce:transition-none" />
    {props.options.map((option, index) => <button
      key={option.value}
      type="button"
      role="radio"
      aria-checked={props.value === option.value}
      disabled={option.disabled}
      tabIndex={props.value === option.value ? 0 : -1}
      data-segmented-option={option.value}
      className="relative z-10 inline-flex h-6 min-w-0 shrink-0 cursor-pointer items-center justify-center whitespace-nowrap rounded-full bg-transparent px-2.5 text-[11px] leading-none text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:z-20 focus-visible:ring-2 focus-visible:ring-ring/30 aria-checked:text-foreground disabled:pointer-events-none disabled:opacity-50"
      onClick={() => props.on_value_change(option.value)}
      onKeyDown={(event) => handle_key_down(event, option.value)}
    >{option.label}</button>)}
  </div>;
}
