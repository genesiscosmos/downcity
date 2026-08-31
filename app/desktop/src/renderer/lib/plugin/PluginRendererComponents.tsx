/**
 * Desktop 注入 Plugin Mainview 的统一 UI Components。
 *
 * Plugin Renderer 只组合这些语义组件，不复制宿主 Tailwind 样式、主题令牌或交互实现。
 * 所有组件直接复用 Desktop 基础控件，因此主题、尺寸、焦点和禁用状态与宿主一致。
 */

import { useState, type KeyboardEvent } from "react";
import { TbChevronDown, TbLoader2 } from "react-icons/tb";
import type { PluginRendererUiComponents } from "@downcity/plugin/react";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

/** 创建稳定的宿主 Plugin UI Components 集合。 */
export function create_plugin_renderer_ui_components(): PluginRendererUiComponents {
  return {
    Page: ({ children }) => <div className="flex min-w-0 flex-col gap-5">{children}</div>,
    Section: ({ title, description, action, surface = true, children }) => <section className="flex min-w-0 flex-col gap-2">
      {title || description || action ? <header className="flex min-w-0 items-start justify-between gap-4 px-2">
        <div className="flex min-w-0 flex-col gap-0.5">
          {title ? <div className="text-xs font-normal text-muted-foreground">{title}</div> : null}
          {description ? <div className="text-[11px] leading-4 text-muted-foreground/75">{description}</div> : null}
        </div>
        {action ? <div className="flex shrink-0 items-center gap-2">{action}</div> : null}
      </header> : null}
      <div className={cn("min-w-0", surface && "overflow-hidden rounded-lg bg-surface-subtle px-3.5 py-3")}>{children}</div>
    </section>,
    Group: ({ children, label, count, action, collapsible = false, default_expanded = true }) => {
      const [expanded, set_expanded] = useState(default_expanded);
      if (!label) return <div className="min-w-0 divide-y divide-border/55 overflow-hidden rounded-lg bg-surface-subtle">{children}</div>;
      return <div className="min-w-0 overflow-hidden rounded-lg bg-surface-subtle">
        <div className="flex min-h-10 items-center">
          <button
            type="button"
            aria-expanded={collapsible ? expanded : undefined}
            className={cn("flex min-h-10 min-w-0 flex-1 items-center gap-2 px-3.5 text-left text-xs text-muted-foreground", collapsible && "transition-colors hover:bg-interaction-hover hover:text-foreground")}
            onClick={() => { if (collapsible) set_expanded((current) => !current); }}
          >
            <span className="min-w-0 flex-1 truncate">{label}</span>
            {typeof count === "number" ? <span className="shrink-0 tabular-nums text-muted-foreground/65">{count}</span> : null}
            {collapsible ? <TbChevronDown className={cn("size-3.5 shrink-0 transition-transform", !expanded && "-rotate-90")} /> : null}
          </button>
          {action ? <div className="flex shrink-0 items-center gap-1 pr-2">{action}</div> : null}
        </div>
        {!collapsible || expanded ? <div className="divide-y divide-border/55 border-t border-border/55">{children}</div> : null}
      </div>;
    },
    Row: ({ label, description, leading, trailing, on_click, disabled }) => {
      const activate = () => { if (!disabled) on_click?.(); };
      const handle_key_down = (event: KeyboardEvent<HTMLDivElement>) => {
        if (on_click && (event.key === "Enter" || event.key === " ")) {
          event.preventDefault();
          activate();
        }
      };
      return <div
        role={on_click ? "button" : undefined}
        tabIndex={on_click && !disabled ? 0 : undefined}
        aria-disabled={on_click ? disabled : undefined}
        onClick={on_click ? activate : undefined}
        onKeyDown={handle_key_down}
        className={cn("flex min-h-12 items-center justify-between gap-4 px-3.5 py-2.5", on_click && "cursor-pointer transition-colors hover:bg-interaction-hover focus-visible:bg-interaction-hover focus-visible:outline-none", disabled && "pointer-events-none opacity-50")}
      >
        <div className="flex min-w-0 flex-1 items-center gap-3">
          {leading ? <div className="flex shrink-0 items-center text-muted-foreground">{leading}</div> : null}
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <div className="text-[13px] text-foreground">{label}</div>
            {description ? <div className="text-xs leading-5 text-muted-foreground">{description}</div> : null}
          </div>
        </div>
        {trailing ? <div className="flex min-w-0 shrink-0 items-center gap-2">{trailing}</div> : null}
      </div>;
    },
    Stack: ({ children }) => <div data-plugin-stack className="flex min-w-0 flex-col gap-5 [&_[data-plugin-stack]]:gap-3">{children}</div>,
    Inline: ({ children, fill }) => <div className={cn("flex flex-wrap items-center gap-2", fill && "[&>*:first-child]:min-w-0 [&>*:first-child]:flex-1")}>{children}</div>,
    Toolbar: ({ title, description, leading, actions }) => <div className="flex min-w-0 flex-wrap items-center gap-2">
      {leading ? <div className="flex shrink-0 items-center">{leading}</div> : null}
      {title || description ? <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        {title ? <div className="truncate text-[13px] text-foreground">{title}</div> : null}
        {description ? <div className="truncate text-[11px] text-muted-foreground">{description}</div> : null}
      </div> : <div className="min-w-0 flex-1" />}
      {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
    </div>,
    Button: ({ children, on_click, disabled, variant = "default", size = "default", title, aria_label }) => <Button variant={variant} size={size} disabled={disabled} onClick={on_click} title={title} aria-label={aria_label}>{children}</Button>,
    Input: ({ value, on_value_change, placeholder, disabled, type = "text", minimum, maximum }) => <input
      value={value}
      onChange={(event) => on_value_change(event.currentTarget.value)}
      placeholder={placeholder}
      disabled={disabled}
      type={type}
      min={minimum}
      max={maximum}
      className="h-8 w-52 min-w-0 rounded-lg bg-control-surface px-2.5 text-xs text-foreground outline-none transition-colors placeholder:text-muted-foreground/55 hover:bg-control-hover focus-visible:ring-2 focus-visible:ring-ring/30 disabled:cursor-not-allowed disabled:opacity-50"
    />,
    Select: ({ value, options, on_value_change, disabled }) => <Select value={value} options={[...options]} on_value_change={on_value_change} disabled={disabled} align="end" />,
    Switch: ({ checked, on_checked_change, disabled, aria_label }) => <Switch checked={checked} onCheckedChange={on_checked_change} disabled={disabled} aria-label={aria_label} />,
    EmptyState: ({ title, description, icon, action, size = "default" }) => <div className={cn("flex flex-col items-center justify-center px-4 text-center", size === "compact" ? "py-8" : "min-h-64 py-12")}>{icon ? <div className="mb-3 flex size-9 items-center justify-center rounded-lg bg-muted/55 text-muted-foreground">{icon}</div> : null}<div className="text-[13px] text-foreground">{title}</div>{description ? <div className="mt-1 max-w-md text-xs leading-5 text-muted-foreground">{description}</div> : null}{action ? <div className="mt-4">{action}</div> : null}</div>,
    LoadingState: ({ label }) => <div className="flex min-h-40 items-center justify-center gap-2 text-xs text-muted-foreground"><TbLoader2 className="size-4 animate-spin" />{label}</div>,
    Callout: ({ children, tone = "default" }) => <div className={cn("rounded-lg px-3 py-2 text-xs leading-5", tone === "default" && "bg-muted/30 text-muted-foreground/80", tone === "warning" && "bg-amber-500/10 text-amber-700 dark:text-amber-400", tone === "danger" && "bg-destructive/10 text-destructive")}>{children}</div>,
    Status: ({ children, tone = "muted" }) => <span className={cn("text-[11px]", tone === "muted" && "text-muted-foreground/65", tone === "success" && "text-emerald-600 dark:text-emerald-400", tone === "warning" && "text-amber-600 dark:text-amber-400", tone === "danger" && "text-destructive")}>{children}</span>,
  };
}
