"use client";
/** 宿主界面共用的胶囊分段选择控件，支持方向键导航、焦点管理和滑动选中态。 */

import type { KeyboardEvent } from "react";
import { selection_indicator_class_name, use_selection_indicator } from "../lib/use-selection-indicator";
import { cn } from "../lib/utils";

/** 按内容收缩的紧凑分段控件；首次显示直接定位，仅选项切换播放滑动动画。 */
export function PillSwitcher<const Value extends string>(props: PillSwitcherProps<Value>) {
  const { group_ref, indicator_ref } = use_selection_indicator<HTMLDivElement>(
    props.value,
    props.options,
    "[data-pill-option]",
    '[data-pill-option][aria-checked="true"]',
  );

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
    if (option.value !== props.value) props.on_value_change(option.value);
    group_ref.current?.querySelector<HTMLButtonElement>(`[data-pill-option="${CSS.escape(option.value)}"]`)?.focus();
  };
  const focus_value = props.options.find((option) => option.value === props.value && !option.disabled)?.value
    ?? props.options.find((option) => !option.disabled)?.value;
  return <div ref={group_ref} role="radiogroup" aria-label={props.aria_label} className={cn("relative isolate inline-flex h-8 w-fit max-w-full flex-none items-center rounded-full bg-control-track p-1", props.class_name)}>
    <span ref={indicator_ref} aria-hidden="true" className={selection_indicator_class_name} />
    {props.options.map((option) => <button
      key={option.value}
      type="button"
      role="radio"
      aria-checked={props.value === option.value}
      disabled={option.disabled}
      tabIndex={focus_value === option.value ? 0 : -1}
      aria-controls={props.controlled_panel_id}
      aria-expanded={props.controlled_panel_id ? props.value === option.value : undefined}
      data-pill-option={option.value}
      className="relative z-10 inline-flex h-6 min-w-0 shrink-0 cursor-pointer items-center justify-center whitespace-nowrap rounded-full bg-transparent px-2.5 text-2xs leading-none text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:z-20 focus-visible:ring-2 focus-visible:ring-ring/30 aria-checked:text-foreground disabled:pointer-events-none disabled:opacity-50"
      onClick={() => props.on_value_change(option.value)}
      onKeyDown={(event) => handle_key_down(event, option.value)}
    >{option.label}</button>)}
  </div>;
}

import type { PillSwitcherProps } from "../types/pill-switcher";
