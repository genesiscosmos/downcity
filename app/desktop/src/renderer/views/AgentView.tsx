/** 使用 Duobox SettingsMainView 结构实现的 Agent 管理页。 */

import { TbCpu, TbFolder, TbLoader2, TbMessageCircle, TbRefresh, TbSparkles } from "react-icons/tb";
import { Button } from "@/components/ui/button";
import { MainViewBody, MainViewLayout } from "@/layouts/MainViewLayout";
import type { DesktopAgentSummary, DesktopWorkspaceSummary } from "@common/types/DesktopApi";
import type { AgentRuntimeState } from "@/types/DesktopView";

/** Agent 管理页属性。 */
interface AgentViewProps {
  /** 当前管理的 Agent 摘要。 */
  agent: DesktopAgentSummary;
  /** 共享 Registry 中的 Workspace，用于展示 Agent 绑定目标。 */
  workspaces: DesktopWorkspaceSummary[];
  /** Agent 持久化绑定的 Workspace ID。 */
  workspace_id: string;
  /** Agent 当前连接状态。 */
  runtime_state: AgentRuntimeState;
  /** 当前已加载的 Session 数量。 */
  session_count: number;
  /** 在 Electron main 中装配 native Agent。 */
  connect_agent(): Promise<void>;
  /** 创建并进入一个 Session。 */
  create_session(): Promise<void>;
}

/** Agent 连接状态对应的可见文案。 */
function get_runtime_text(state: AgentRuntimeState): string {
  if (state === "connected") return "Native Agent 已就绪";
  if (state === "connecting") return "正在装配 Native Agent";
  if (state === "error") return "Native Agent 装配失败";
  return "Native Agent 尚未装配";
}

/** Agent 配置与运行管理主视图。 */
export function AgentView({ agent, workspaces, workspace_id, runtime_state, session_count, connect_agent, create_session }: AgentViewProps) {
  const workspace = workspaces.find((item) => item.workspace_id === workspace_id);
  return <MainViewLayout>
    <header className="header-drag-region flex h-10 w-full flex-none items-center gap-2 px-2">
      <div className="flex min-w-0 flex-1 items-center gap-1.5 pl-1 text-xs text-muted-foreground/60">
        <TbCpu className="size-3.5" />
        <span className="truncate font-medium text-foreground/80">{agent.agent_id}</span>
      </div>
      <Button disabled={runtime_state === "connecting" || !workspace_id} onClick={() => void connect_agent()}>
        {runtime_state === "connecting" ? <TbLoader2 className="animate-spin" /> : <TbRefresh />}
        <span>{runtime_state === "connected" ? "刷新" : "连接"}</span>
      </Button>
      <Button variant="primary" disabled={runtime_state === "connecting"} onClick={() => void create_session()}><TbMessageCircle /><span>新建 Session</span></Button>
    </header>
    <MainViewBody>
      <div className="min-h-0 min-w-0 flex-1 overflow-y-auto bg-background">
        <div className="mx-auto w-full max-w-3xl px-8 pb-12 pt-18">
          <div className="mb-8 flex items-center gap-4">
            <div className="flex size-14 shrink-0 items-center justify-center rounded-2xl bg-muted text-muted-foreground"><TbCpu className="size-7" /></div>
            <div className="min-w-0 flex-1">
              <div className="truncate text-xl font-semibold text-foreground">{agent.agent_id}</div>
              <div className="mt-1 text-xs text-muted-foreground">{get_runtime_text(runtime_state)}</div>
            </div>
            <div className="flex items-center gap-1.5 rounded-full bg-surface-subtle px-2.5 py-1 text-[0.6875rem] text-muted-foreground">
              <span className={`size-1.5 rounded-full ${runtime_state === "connected" ? "bg-emerald-500" : runtime_state === "error" ? "bg-destructive" : "bg-muted-foreground/30"}`} />
              {runtime_state === "connected" ? "Connected" : "Offline"}
            </div>
          </div>

          <section className="mb-7">
            <h2 className="mb-2 px-1 text-xs font-semibold text-foreground">概览</h2>
            <div className="grid grid-cols-3 gap-2">
              <SummaryCard icon={<TbFolder />} label="Workspace" value={workspace?.name || "未绑定"} />
              <SummaryCard icon={<TbSparkles />} label="Model" value={agent.model_id || "未配置"} />
              <SummaryCard icon={<TbMessageCircle />} label="Sessions" value={String(session_count)} />
            </div>
          </section>

          <section>
            <h2 className="mb-2 px-1 text-xs font-semibold text-foreground">Agent 配置</h2>
            <div className="overflow-hidden rounded-xl bg-surface-subtle">
              <PropertyRow label="Agent ID" value={agent.agent_id} />
              <PropertyRow label="运行 Workspace" value={workspace?.workspace_path || "—"} />
              <PropertyRow label="Model ID" value={agent.model_id || "—"} />
              <PropertyRow label="配置版本" value={agent.version} last />
            </div>
          </section>
        </div>
      </div>
    </MainViewBody>
  </MainViewLayout>;
}

/** Agent 概览卡片。 */
function SummaryCard({ icon, label, value }: { /** 左侧图标。 */ icon: React.ReactNode; /** 指标名称。 */ label: string; /** 指标当前值。 */ value: string }) {
  return <div className="flex min-w-0 flex-col gap-3 rounded-xl bg-surface-subtle p-3.5">
    <div className="flex size-7 items-center justify-center rounded-lg bg-control-hover text-muted-foreground [&_svg]:size-3.5">{icon}</div>
    <div className="min-w-0"><div className="text-[0.625rem] text-muted-foreground">{label}</div><div className="mt-0.5 truncate text-xs font-medium text-foreground" title={value}>{value}</div></div>
  </div>;
}

/** Agent 配置属性行。 */
function PropertyRow({ label, value, last = false }: { /** 属性名称。 */ label: string; /** 属性值。 */ value: string; /** 是否为最后一行。 */ last?: boolean }) {
  return <div className={`grid min-h-11 grid-cols-[9rem_minmax(0,1fr)] items-center px-3.5 ${last ? "" : "border-b border-border/45"}`}>
    <span className="text-[0.6875rem] text-muted-foreground">{label}</span>
    <span className="truncate font-mono text-[0.6875rem] text-foreground/80" title={value}>{value}</span>
  </div>;
}
