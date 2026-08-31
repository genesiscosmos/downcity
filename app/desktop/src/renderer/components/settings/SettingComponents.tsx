/** Agent 与 Group 配置页共享的 Duobox 风格设置布局原语。 */

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** 设置内容的垂直节奏容器。 */
export function SettingsContainer({ children }: { /** 设置分区。 */ children: ReactNode }) {
  return <div className="flex flex-col gap-7">{children}</div>;
}

/** 带标题与说明的设置分区。 */
export function SettingSection({ title, description, action, children }: { /** 分区标题。 */ title?: string; /** 分区说明。 */ description?: string; /** 分区右侧操作。 */ action?: ReactNode; /** 分区内容。 */ children: ReactNode }) {
  return <section className="flex min-w-0 flex-col gap-2">{title || description || action ? <header className="flex items-start justify-between gap-4 px-2"><div className="flex min-w-0 flex-col gap-0.5">{title ? <h2 className="text-xs font-normal text-muted-foreground">{title}</h2> : null}{description ? <p className="text-[11px] text-muted-foreground/75">{description}</p> : null}</div>{action ? <div className="flex shrink-0 items-center gap-2">{action}</div> : null}</header> : null}<div className="min-w-0">{children}</div></section>;
}

/** 具有统一圆角、背景与分隔线的设置组。 */
export function SettingGroup({ children, class_name }: { /** 设置行。 */ children: ReactNode; /** 附加样式。 */ class_name?: string }) {
  return <div className={cn("min-w-0 divide-y divide-border/45 overflow-hidden rounded-lg bg-surface-subtle", class_name)}>{children}</div>;
}

/** 左侧说明、右侧控件的标准设置行。 */
export function SettingItem({ label, description, leading, children }: { /** 设置名称。 */ label: string; /** 设置说明。 */ description?: string; /** 左侧语义图标。 */ leading?: ReactNode; /** 行尾控件。 */ children: ReactNode }) {
  return <div className="flex min-h-14 items-center justify-between gap-6 px-3.5 py-2.5">{leading ? <span className="flex size-5 shrink-0 items-center justify-center text-muted-foreground [&_svg]:size-4">{leading}</span> : null}<div className="flex min-w-0 flex-1 flex-col gap-0.5"><span className="text-[13px] text-foreground">{label}</span>{description ? <p className="text-xs text-muted-foreground">{description}</p> : null}</div><div className="flex max-w-[55%] shrink-0 justify-end">{children}</div></div>;
}

/** 可进入子配置页的标准动作行。 */
export function SettingActionItem({ label, description, icon, trailing, active = false, on_select }: { /** 动作名称。 */ label: string; /** 动作说明。 */ description?: string; /** 左侧图标。 */ icon?: ReactNode; /** 右侧摘要或图标。 */ trailing?: ReactNode; /** 是否选中。 */ active?: boolean; /** 进入配置页。 */ on_select(): void }) {
  return <button type="button" onClick={on_select} className={cn("flex min-h-14 w-full items-center gap-3 px-3.5 py-2.5 text-left outline-none transition-colors hover:bg-interaction-hover focus-visible:bg-interaction-hover", active && "bg-interaction-selected hover:bg-interaction-active")}>{icon ? <span className="flex size-5 shrink-0 items-center justify-center text-muted-foreground [&_svg]:size-4">{icon}</span> : null}<span className="min-w-0 flex-1"><span className="block truncate text-[13px] text-foreground">{label}</span>{description ? <span className="mt-0.5 block truncate text-xs text-muted-foreground">{description}</span> : null}</span>{trailing ? <span className="flex max-w-[45%] shrink-0 items-center gap-1.5 text-xs text-muted-foreground">{trailing}</span> : null}</button>;
}

/** MainView 中设置内容的标准宽度与留白。 */
export function SettingsMainContent({ children }: { /** 设置正文。 */ children: ReactNode }) {
  return <div className="mx-auto w-full max-w-3xl px-8 pb-12 pt-14">{children}</div>;
}
