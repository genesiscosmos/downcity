/**
 * Desktop 注入 Plugin Mainview 的统一 UI Components。
 *
 * Plugin Renderer 只组合这些语义组件，不复制宿主 Tailwind 样式、主题令牌或交互实现。
 * 所有组件直接复用 Desktop 基础控件，因此主题、尺寸、焦点和禁用状态与宿主一致。
 */

import { Fragment, useState, type KeyboardEvent } from "react";
import { TbChevronDown, TbChevronRight, TbDots, TbLoader2, TbPlus } from "react-icons/tb";
import type { PluginRendererUiComponents } from "@downcity/city/plugin/react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown";
import { Select } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Markdown } from "@/components/markdown/Markdown";
import { SidebarHeader } from "@/layouts/sidebar/SidebarHeader";
import { SidebarContent } from "@/layouts/sidebar/SidebarPanel";
import { cn } from "@/lib/utils";

/** 创建 Plugin UI Components 时需要的宿主上下文。 */
interface PluginRendererUiComponentOptions {
  /** 当前 Plugin 的稳定 ID，用于隔离宿主持久化的布局偏好。 */
  readonly plugin_id: string;

  /** 当前 UI Components 服务的 Renderer 插槽。 */
  readonly surface: "sidebar" | "mainview" | "config";

  /** Sidebar Header 中展示的 Plugin 标题。 */
  readonly sidebar_title?: string;
}

/** 创建稳定的宿主 Plugin UI Components 集合。 */
export function create_plugin_renderer_ui_components(options: PluginRendererUiComponentOptions): PluginRendererUiComponents {
  return {
    Sidebar: ({ children, actions }) => <><SidebarHeader title={options.sidebar_title ?? options.plugin_id} actions={actions} /><SidebarContent class_name="flex flex-col">{children}</SidebarContent></>,
    SidebarSection: ({ label, children }) => <section className="mb-4 min-w-0">
      {label ? <h3 className="px-2 pb-1.5 pt-1 text-[0.625rem] font-medium uppercase tracking-[0.08em] text-muted-foreground/65">{label}</h3> : null}
      <div className="space-y-0.5">{children}</div>
    </section>,
    SidebarItem: ({ label, description, leading, trailing, active, disabled, on_select }) => <button
      type="button"
      aria-current={active ? "page" : undefined}
      disabled={disabled}
      onClick={on_select}
      className={cn("flex min-h-10 w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/30", active ? "bg-interaction-selected text-foreground" : "text-foreground/85 hover:bg-interaction-hover", disabled && "opacity-45")}
    >
      {leading ? <span className="flex size-5 shrink-0 items-center justify-center text-muted-foreground">{leading}</span> : null}
      <span className="min-w-0 flex-1"><span className="block truncate text-xs">{label}</span>{description ? <span className="mt-0.5 block truncate text-[10px] text-muted-foreground/65">{description}</span> : null}</span>
      {trailing ? <span className="shrink-0 text-[10px] text-muted-foreground/65">{trailing}</span> : null}
    </button>,
    SidebarTreeItem: ({ label, leading, trailing, depth, kind, active, expanded, on_toggle, disabled, on_select }) => {
      const is_branch = (kind ?? (on_toggle ? "branch" : "leaf")) === "branch";
      const aligns_with_parent_text = depth > 0 && !is_branch && !leading;
      const indentation = aligns_with_parent_text ? 24 + (depth - 1) * 12 : depth * 12;
      return <div
        style={indentation === 0 ? undefined : { paddingLeft: indentation }}
      >
        <div className={cn("group/item flex min-h-8 w-full items-center gap-1 rounded-lg py-0.5 pr-1 text-left transition-colors duration-150", aligns_with_parent_text ? "pl-2" : "pl-1", active ? "bg-primary/[0.1] text-foreground" : "text-foreground/85 hover:bg-foreground/[0.07]", disabled && "opacity-45")}>
          {is_branch ? <button type="button" aria-label={`${expanded ? "折叠" : "展开"} ${String(label)}`} aria-expanded={expanded} disabled={disabled} onClick={(event) => { event.stopPropagation(); on_toggle?.(); }} className="flex size-6 shrink-0 items-center justify-center rounded-md bg-transparent p-0 text-muted-foreground/70 outline-none transition-colors hover:bg-interaction-hover hover:text-foreground focus-visible:bg-interaction-hover focus-visible:ring-2 focus-visible:ring-ring/30"><TbChevronRight className={cn("size-3.5 transition-transform duration-150 motion-reduce:transition-none", expanded && "rotate-90")} /></button> : leading ? <span className={cn("flex size-6 shrink-0 items-center justify-center", active ? "text-primary" : "text-muted-foreground/70")} aria-hidden="true">{leading}</span> : null}
          <button type="button" aria-current={active ? "page" : undefined} disabled={disabled} onClick={on_select} className="flex min-w-0 flex-1 items-center gap-1.5 self-stretch text-left outline-none focus-visible:ring-2 focus-visible:ring-ring/30">
            {is_branch && leading ? <span className={cn("flex size-4 shrink-0 items-center justify-center", active ? "text-primary" : "text-muted-foreground/70")}>{leading}</span> : null}
            <span className="min-w-0 flex-1 truncate text-xs">{label}</span>
          </button>
          {trailing != null ? <span className="flex min-w-6 shrink-0 items-center justify-end gap-1 text-[10px] text-muted-foreground/65">{typeof trailing === "number" ? <span className="flex size-6 shrink-0 items-center justify-center rounded-md bg-foreground/[0.06] tabular-nums">{trailing}</span> : trailing}</span> : null}
        </div>
      </div>;
    },
    ItemMenu: ({ label, actions, reveal_on_hover = false }) => <DropdownMenu>
      <DropdownMenuTrigger asChild><button type="button" aria-label={label} title={label} onClick={(event) => event.stopPropagation()} className={cn("flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground outline-none transition-[background-color,color,opacity] duration-150 hover:bg-interaction-hover hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/30 data-[popup-open]:bg-interaction-hover data-[popup-open]:text-foreground", reveal_on_hover && "pointer-events-none opacity-0 group-hover/item:pointer-events-auto group-hover/item:opacity-100 group-focus-within/item:pointer-events-auto group-focus-within/item:opacity-100 data-[popup-open]:pointer-events-auto data-[popup-open]:opacity-100")}><TbDots className="size-3.5" /></button></DropdownMenuTrigger>
      <DropdownMenuContent align="end" onClick={(event) => event.stopPropagation()}>{actions.map((action) => <Fragment key={action.action_id}>{action.separator_before ? <DropdownMenuSeparator /> : null}<DropdownMenuItem disabled={action.disabled} className={action.destructive ? "text-destructive" : undefined} onClick={() => void action.on_select()}>{action.leading}<span>{action.label}</span></DropdownMenuItem></Fragment>)}</DropdownMenuContent>
    </DropdownMenu>,
    SidebarCreateMenu: ({ label, actions }) => <DropdownMenu>
      <DropdownMenuTrigger asChild><Button size="icon" title={label} aria-label={label}><TbPlus /></Button></DropdownMenuTrigger>
      <DropdownMenuContent align="end">{actions.map((action) => <Fragment key={action.action_id}>{action.separator_before ? <DropdownMenuSeparator /> : null}<DropdownMenuItem disabled={action.disabled} className={action.destructive ? "text-destructive" : undefined} onClick={() => void action.on_select()}>{action.leading}<span>{action.label}</span></DropdownMenuItem></Fragment>)}</DropdownMenuContent>
    </DropdownMenu>,
    Page: ({ children }) => options.surface === "mainview"
      ? <div className="sidebar-body-scroll h-full min-h-0 min-w-0 flex-1 overflow-y-auto bg-background"><div className="mx-auto flex min-h-full w-full max-w-5xl flex-col gap-5 px-4 pb-10 pt-4 md:px-8 md:pt-6">{children}</div></div>
      : <div className="flex min-w-0 flex-col gap-5">{children}</div>,
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
        className={cn("group/item flex min-h-12 items-center justify-between gap-4 px-3.5 py-2.5", on_click && "cursor-pointer transition-colors hover:bg-interaction-hover focus-visible:bg-interaction-hover focus-visible:outline-none", disabled && "pointer-events-none opacity-50")}
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
    Tabs: ({ value, label, items, on_value_change }) => <div role="tablist" aria-label={label} className="scrollbar-none flex min-w-0 overflow-x-auto border-b border-divider">
      {items.map((item) => <button
        key={item.value}
        type="button"
        role="tab"
        aria-selected={item.value === value}
        onClick={() => on_value_change(item.value)}
        className={cn(
          "relative flex h-9 shrink-0 items-center gap-1.5 px-3 text-xs outline-none transition-colors after:absolute after:inset-x-2 after:bottom-0 after:h-0.5 after:rounded-full",
          item.value === value
            ? "text-foreground after:bg-primary"
            : "text-muted-foreground after:bg-transparent hover:text-foreground focus-visible:bg-interaction-hover",
        )}
      >
        <span>{item.label}</span>
        {typeof item.count === "number" ? <span className="tabular-nums text-[10px] text-muted-foreground/65">{item.count}</span> : null}
      </button>)}
    </div>,
    CodeBlock: ({ children }) => <pre className="max-h-[32rem] min-w-0 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-surface-subtle px-4 py-3 font-mono text-[11px] leading-5 text-foreground/85">{children}</pre>,
    Markdown: ({ text }) => <div className="text-[13px] leading-[1.6]"><Markdown text={text} mode="static" /></div>,
    Button: ({ children, on_click, disabled, variant = "default", size = "default", title, aria_label }) => <Button variant={variant} size={size} disabled={disabled} onClick={on_click} title={title} aria-label={aria_label}>{children}</Button>,
    Input: ({ value, on_value_change, placeholder, disabled, type = "text", minimum, maximum, fill = false }) => <input
      value={value}
      onChange={(event) => on_value_change(event.currentTarget.value)}
      placeholder={placeholder}
      disabled={disabled}
      type={type}
      min={minimum}
      max={maximum}
      className={cn("h-8 min-w-0 rounded-lg bg-control-surface px-2.5 text-xs text-foreground outline-none transition-colors placeholder:text-muted-foreground/55 hover:bg-control-hover focus-visible:ring-2 focus-visible:ring-ring/30 disabled:cursor-not-allowed disabled:opacity-50", fill ? "w-full" : "w-52")}
    />,
    Field: ({ label, description, error, children }) => <div className="flex min-w-0 flex-col gap-1.5">
      <span className="text-xs text-foreground/85">{label}</span>
      {description ? <span className="text-[11px] leading-4 text-muted-foreground/70">{description}</span> : null}
      {children}
      {error ? <span className="text-[11px] leading-4 text-destructive">{error}</span> : null}
    </div>,
    Textarea: ({ value, on_value_change, placeholder, disabled, rows = 8 }) => <textarea
      value={value}
      onChange={(event) => on_value_change(event.currentTarget.value)}
      placeholder={placeholder}
      disabled={disabled}
      rows={rows}
      className="min-h-24 w-full min-w-0 resize-y rounded-lg bg-control-surface px-2.5 py-2 text-xs leading-5 text-foreground outline-none transition-colors placeholder:text-muted-foreground/55 hover:bg-control-hover focus-visible:ring-2 focus-visible:ring-ring/30 disabled:cursor-not-allowed disabled:opacity-50"
    />,
    Select: ({ value, options, on_value_change, disabled, fill = false }) => <Select value={value} options={[...options]} on_value_change={on_value_change} disabled={disabled} className={fill ? "w-full" : undefined} align="end" />,
    Switch: ({ checked, on_checked_change, disabled, aria_label }) => <Switch checked={checked} onCheckedChange={on_checked_change} disabled={disabled} aria-label={aria_label} />,
    EmptyState: ({ title, description, icon, action, size = "default" }) => <div className={cn("flex flex-col items-center justify-center px-4 text-center", size === "compact" ? "py-8" : "min-h-64 py-12")}>{icon ? <div className="mb-3 flex size-9 items-center justify-center rounded-lg bg-muted/55 text-muted-foreground">{icon}</div> : null}<div className="text-[13px] text-foreground">{title}</div>{description ? <div className="mt-1 max-w-md text-xs leading-5 text-muted-foreground">{description}</div> : null}{action ? <div className="mt-4">{action}</div> : null}</div>,
    LoadingState: ({ label }) => <div className="flex min-h-40 items-center justify-center gap-2 text-xs text-muted-foreground"><TbLoader2 className="size-4 animate-spin" />{label}</div>,
    Callout: ({ children, tone = "default" }) => <div className={cn("rounded-lg px-3 py-2 text-xs leading-5", tone === "default" && "bg-muted/30 text-muted-foreground/80", tone === "warning" && "bg-amber-500/10 text-amber-700 dark:text-amber-400", tone === "danger" && "bg-destructive/10 text-destructive")}>{children}</div>,
    Status: ({ children, tone = "muted" }) => <span className={cn("text-[11px]", tone === "muted" && "text-muted-foreground/65", tone === "success" && "text-emerald-600 dark:text-emerald-400", tone === "warning" && "text-amber-600 dark:text-amber-400", tone === "danger" && "text-destructive")}>{children}</span>,
  };
}
