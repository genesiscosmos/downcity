/** Plugin manifest、绑定与资源概览页。 */

import { TbComponents, TbDatabase, TbRobot, TbSettings } from "react-icons/tb";
import { MainViewBody, MainViewLayout } from "@/layouts/MainViewLayout";
import type { DesktopPluginSummary } from "@common/types/DesktopApi";

/** Plugin 详情属性。 */
interface PluginViewProps { /** 当前 Plugin。 */ plugin: DesktopPluginSummary; }

/** 只展示 Desktop 当前真实掌握的 Plugin 能力。 */
export function PluginView({ plugin }: PluginViewProps) {
  return <MainViewLayout><header className="header-drag-region flex h-10 items-center gap-2 px-3 text-xs"><TbComponents className="text-muted-foreground" /><span className="truncate font-medium text-foreground/80">{plugin.title}</span></header><MainViewBody><div className="min-h-0 min-w-0 flex-1 overflow-y-auto bg-background"><div className="mx-auto w-full max-w-[42rem] px-6 pb-12 pt-14">
    <div className="mb-9 flex items-start gap-4"><div className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-surface-subtle text-muted-foreground"><TbComponents className="size-6" /></div><div className="min-w-0"><h1 className="text-lg font-semibold text-foreground">{plugin.title}</h1><p className="mt-1 text-xs leading-5 text-muted-foreground">{plugin.description || plugin.plugin_name}</p></div></div>
    <section className="mb-7"><h2 className="mb-2 px-1 text-xs font-semibold text-foreground">Plugin</h2><div className="overflow-hidden rounded-lg bg-surface-subtle"><InfoRow label="Plugin ID" value={plugin.plugin_name} /><InfoRow label="Source" value={plugin.source === "builtin" ? "Official" : "Installed"} /><InfoRow label="Version" value={plugin.version || "Built-in"} last /></div></section>
    <section className="mb-7"><h2 className="mb-2 px-1 text-xs font-semibold text-foreground">Capabilities</h2><div className="overflow-hidden rounded-lg bg-surface-subtle"><CapabilityRow icon={<TbRobot />} label="Bound Agents" value={plugin.agent_ids.length ? plugin.agent_ids.join(", ") : "None"} /><CapabilityRow icon={<TbDatabase />} label="Resources" value={String(plugin.resource_count)} /><CapabilityRow icon={<TbSettings />} label="Configuration" value={plugin.configurable ? "Supported" : "Not required"} last /></div></section>
  </div></div></MainViewBody></MainViewLayout>;
}

/** Plugin 文本属性行。 */
function InfoRow({ label, value, last = false }: { /** 属性名。 */ label: string; /** 属性值。 */ value: string; /** 是否最后一行。 */ last?: boolean }) { return <div className={`grid min-h-11 grid-cols-[8rem_minmax(0,1fr)] items-center px-3.5 ${last ? "" : "border-b border-border/45"}`}><span className="text-[0.6875rem] text-muted-foreground">{label}</span><span className="truncate text-right font-mono text-[0.6875rem] text-foreground/80">{value}</span></div>; }

/** Plugin 能力行。 */
function CapabilityRow({ icon, label, value, last = false }: { /** 能力图标。 */ icon: React.ReactNode; /** 能力名。 */ label: string; /** 能力值。 */ value: string; /** 是否最后一行。 */ last?: boolean }) { return <div className={`grid min-h-11 grid-cols-[1rem_8rem_minmax(0,1fr)] items-center gap-3 px-3.5 ${last ? "" : "border-b border-border/45"}`}><span className="text-muted-foreground [&_svg]:size-4">{icon}</span><span className="text-[0.6875rem] text-muted-foreground">{label}</span><span className="truncate text-right text-[0.6875rem] text-foreground/80">{value}</span></div>; }
