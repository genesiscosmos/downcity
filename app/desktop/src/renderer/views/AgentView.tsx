/** Agent 身份、运行配置、Plugin 与近期 Session 管理页。 */

import { TbComponents, TbFolder, TbMessageCircle, TbRobot } from "react-icons/tb";
import { Button } from "@/components/ui/button";
import { LLMModelIcon } from "@/components/model/LLMModelIcon";
import { MainViewBody, MainViewLayout } from "@/layouts/MainViewLayout";
import type { DesktopAgentSummary, DesktopPluginSummary, DesktopSessionSummary, DesktopWorkspaceSummary } from "@common/types/DesktopApi";

/** Agent 管理页属性。 */
interface AgentViewProps {
  /** 当前 Agent。 */ agent: DesktopAgentSummary;
  /** 全部 Workspace。 */ workspaces: DesktopWorkspaceSummary[];
  /** 当前 Agent 绑定的 Plugin。 */ plugins: DesktopPluginSummary[];
  /** 当前 Agent 的 Session。 */ sessions: DesktopSessionSummary[];
  /** 创建空对话。 */ create_session(): Promise<void>;
  /** 进入 Session。 */ select_session(session_id: string): Promise<void>;
}

/** 安静、可扫描的 Agent 管理界面。 */
export function AgentView({ agent, workspaces, plugins, sessions, create_session, select_session }: AgentViewProps) {
  const workspace = workspaces.find((item) => item.workspace_id === agent.workspace_id);
  const bound_plugins = plugins.filter((plugin) => plugin.agent_ids.includes(agent.agent_id));
  const recent_sessions = [...sessions].sort((left, right) => right.updated_at - left.updated_at).slice(0, 5);
  return <MainViewLayout>
    <header className="header-drag-region flex h-10 w-full flex-none items-center gap-2 px-2"><div className="flex min-w-0 flex-1 items-center gap-1.5 pl-1 text-xs text-muted-foreground"><TbRobot /><span className="truncate font-medium text-foreground/80">{agent.agent_id}</span></div><Button variant="primary" onClick={() => void create_session()}><TbMessageCircle /><span>新对话</span></Button></header>
    <MainViewBody><div className="min-h-0 min-w-0 flex-1 overflow-y-auto bg-background"><div className="mx-auto w-full max-w-[42rem] px-6 pb-12 pt-14">
      <div className="mb-9 flex min-w-0 items-center gap-4"><div className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-surface-subtle text-muted-foreground"><TbRobot className="size-6" /></div><div className="min-w-0"><h1 className="truncate text-lg font-semibold text-foreground">{agent.agent_id}</h1><p className="mt-1 truncate text-xs text-muted-foreground" title={workspace?.workspace_path}>{workspace?.workspace_path || "未绑定 Workspace"}</p></div></div>
      <SettingsGroup title="Runtime"><PropertyRow icon={<TbFolder />} label="Workspace" value={workspace?.workspace_path || "未绑定"} /><PropertyRow icon={<LLMModelIcon model_id={agent.model_id} size_class="size-4" />} label="Model" value={agent.model_id || "未配置"} /><PropertyRow icon={<TbRobot />} label="Version" value={agent.version} last /></SettingsGroup>
      <SettingsGroup title="Plugins">{bound_plugins.length > 0 ? bound_plugins.map((plugin, index) => <PropertyRow key={plugin.plugin_name} icon={<TbComponents />} label={plugin.title} value={plugin.plugin_name} last={index === bound_plugins.length - 1} />) : <EmptyRow text="尚未绑定 Plugin" />}</SettingsGroup>
      <SettingsGroup title="Recent Sessions">{recent_sessions.length > 0 ? recent_sessions.map((session, index) => <button key={session.session_id} className={`flex min-h-11 w-full items-center gap-3 px-3.5 text-left hover:bg-foreground/[0.04] ${index === recent_sessions.length - 1 ? "" : "border-b border-border/45"}`} onClick={() => void select_session(session.session_id)}><TbMessageCircle className="size-4 shrink-0 text-muted-foreground" /><span className="min-w-0 flex-1 truncate text-xs text-foreground">{session.title || "新对话"}</span><span className="text-[0.625rem] text-muted-foreground">{session.message_count} messages</span></button>) : <EmptyRow text="暂无 Session" />}</SettingsGroup>
    </div></div></MainViewBody>
  </MainViewLayout>;
}

/** 设置式信息分组。 */
function SettingsGroup({ title, children }: { /** 分组标题。 */ title: string; /** 分组内容。 */ children: React.ReactNode }) { return <section className="mb-7"><h2 className="mb-2 px-1 text-xs font-semibold text-foreground">{title}</h2><div className="overflow-hidden rounded-lg bg-surface-subtle">{children}</div></section>; }

/** Agent 属性行。 */
function PropertyRow({ icon, label, value, last = false }: { /** 属性图标。 */ icon: React.ReactNode; /** 属性名称。 */ label: string; /** 属性值。 */ value: string; /** 是否最后一行。 */ last?: boolean }) { return <div className={`grid min-h-11 grid-cols-[1rem_7rem_minmax(0,1fr)] items-center gap-3 px-3.5 ${last ? "" : "border-b border-border/45"}`}><span className="text-muted-foreground [&_svg]:size-4">{icon}</span><span className="text-[0.6875rem] text-muted-foreground">{label}</span><span className="truncate text-right font-mono text-[0.6875rem] text-foreground/80" title={value}>{value}</span></div>; }

/** 空分组占位。 */
function EmptyRow({ text }: { /** 空状态文本。 */ text: string }) { return <div className="px-3.5 py-4 text-xs text-muted-foreground">{text}</div>; }
