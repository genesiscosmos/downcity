/** Workspace 上下文、Agent 与近期 Session 管理页。 */

import { TbFolder, TbMessageCircle, TbPlus, TbRobot } from "react-icons/tb";
import { Button } from "@/components/ui/button";
import { MainViewBody, MainViewLayout } from "@/layouts/MainViewLayout";
import type { DesktopAgentSummary, DesktopSessionSummary, DesktopWorkspaceSummary } from "@common/types/DesktopApi";

/** Workspace 主视图属性。 */
interface WorkspaceViewProps {
  /** 当前打开的 Workspace。 */ workspace: DesktopWorkspaceSummary;
  /** 当前 Workspace 下的 Agent。 */ agents: DesktopAgentSummary[];
  /** 全部 Agent Session 投影。 */ sessions_by_agent: Record<string, DesktopSessionSummary[]>;
  /** 在 Workspace 中创建 Agent。 */ open_create_agent(): void;
  /** 打开 Agent 管理页。 */ select_agent(agent_id: string): void;
  /** 进入 Session。 */ select_session(agent_id: string, session_id: string): Promise<void>;
}

/** 打开 Workspace 后展示其真实运行上下文。 */
export function WorkspaceView({ workspace, agents, sessions_by_agent, open_create_agent, select_agent, select_session }: WorkspaceViewProps) {
  const recent_sessions = agents.flatMap((agent) => (sessions_by_agent[agent.agent_id] ?? []).map((session) => ({ agent, session }))).sort((left, right) => right.session.updated_at - left.session.updated_at).slice(0, 8);
  return <MainViewLayout>
    <header className="header-drag-region flex h-10 w-full flex-none items-center gap-2 px-2"><div className="flex min-w-0 flex-1 items-center gap-1.5 pl-1 text-xs text-muted-foreground"><TbFolder /><span className="truncate font-medium text-foreground/80">{workspace.name}</span></div><Button variant="primary" onClick={open_create_agent}><TbPlus /><span>创建 Agent</span></Button></header>
    <MainViewBody><div className="min-h-0 min-w-0 flex-1 overflow-y-auto bg-background"><div className="mx-auto w-full max-w-[42rem] px-6 pb-12 pt-14">
      <div className="mb-9 flex min-w-0 items-center gap-4"><div className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-surface-subtle text-muted-foreground"><TbFolder className="size-6" /></div><div className="min-w-0"><h1 className="truncate text-lg font-semibold text-foreground">{workspace.name}</h1><p className="mt-1 truncate text-xs text-muted-foreground" title={workspace.workspace_path}>{workspace.workspace_path}</p></div></div>
      <section className="mb-7"><h2 className="mb-2 px-1 text-xs font-semibold text-foreground">Agents</h2><div className="overflow-hidden rounded-lg bg-surface-subtle">{agents.length > 0 ? agents.map((agent, index) => <button key={agent.agent_id} className={`flex min-h-11 w-full items-center gap-3 px-3.5 text-left hover:bg-foreground/[0.04] ${index === agents.length - 1 ? "" : "border-b border-border/45"}`} onClick={() => select_agent(agent.agent_id)}><TbRobot className="size-4 shrink-0 text-muted-foreground" /><span className="min-w-0 flex-1 truncate text-xs text-foreground">{agent.agent_id}</span><span className="text-[0.625rem] text-muted-foreground">{(sessions_by_agent[agent.agent_id] ?? []).length} sessions</span></button>) : <div className="flex min-h-20 flex-col items-start justify-center px-3.5"><div className="text-xs text-foreground">尚未创建 Agent</div><button className="mt-1 text-[0.6875rem] text-primary hover:underline" onClick={open_create_agent}>在此 Workspace 中创建</button></div>}</div></section>
      <section className="mb-7"><h2 className="mb-2 px-1 text-xs font-semibold text-foreground">Recent Sessions</h2><div className="overflow-hidden rounded-lg bg-surface-subtle">{recent_sessions.length > 0 ? recent_sessions.map(({ agent, session }, index) => <button key={`${agent.agent_id}:${session.session_id}`} className={`flex min-h-11 w-full items-center gap-3 px-3.5 text-left hover:bg-foreground/[0.04] ${index === recent_sessions.length - 1 ? "" : "border-b border-border/45"}`} onClick={() => void select_session(agent.agent_id, session.session_id)}><TbMessageCircle className="size-4 shrink-0 text-muted-foreground" /><span className="min-w-0 flex-1 truncate text-xs text-foreground">{session.title || "新对话"}</span><span className="max-w-28 truncate text-[0.625rem] text-muted-foreground">{agent.agent_id}</span></button>) : <div className="px-3.5 py-4 text-xs text-muted-foreground">暂无 Session</div>}</div></section>
    </div></div></MainViewBody>
  </MainViewLayout>;
}
