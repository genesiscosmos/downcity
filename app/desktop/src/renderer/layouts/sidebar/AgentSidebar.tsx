/** Agent 集合 Sidebar。 */

import { TbCopy, TbDots, TbMessageCircle } from "react-icons/tb";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown";
import { AgentAvatar } from "@/components/AgentAvatar";
import { cn } from "@/lib/utils";
import { get_session_key, is_chat_busy, type DesktopViewController } from "@/types/DesktopView";

/** Agent Sidebar 属性。 */
interface AgentSidebarProps { /** 根状态控制器。 */ controller: DesktopViewController; /** 打开创建表单。 */ open_create_agent(): void; }

/** 展示扁平 Agent 列表和创建入口。 */
export function AgentSidebar({ controller, open_create_agent }: AgentSidebarProps) {
  return <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
    <div data-sidebar-scrollable="true" className="sidebar-body-scroll min-h-0 flex-1 space-y-1 overflow-y-auto px-2 pb-2">
      {controller.agents.map((agent) => {
        const active = controller.selection?.kind === "agent" && controller.selection.agent_id === agent.agent_id;
        const status_label = get_agent_status_label(controller, agent.agent_id);
        const model_label = controller.models.find((model) => model.model_id === agent.model_id)?.name || agent.model_id || "未配置模型";
        return <div key={agent.agent_id} role="button" tabIndex={0} className={cn("group relative flex min-h-12 w-full cursor-pointer items-center gap-2 rounded-lg border border-transparent px-1.5 py-1 transition-all duration-200", active ? "bg-primary/[0.1] hover:bg-primary/[0.12]" : "hover:bg-foreground/[0.07]")} onClick={() => controller.select_agent(agent.agent_id)}>
          <AgentAvatar agent={agent} class_name="size-8" /><span className="min-w-0 flex-1"><span className="block truncate text-xs font-medium text-foreground">{agent.agent_id}</span><span className={cn("mt-0.5 block truncate text-[10px]", status_label ? "text-primary" : "text-muted-foreground/70")}>{status_label || model_label}</span></span>
          <DropdownMenu><DropdownMenuTrigger asChild><Button size="icon" className="opacity-0 group-hover:opacity-100 data-[state=open]:opacity-100" onClick={(event) => event.stopPropagation()}><TbDots /></Button></DropdownMenuTrigger><DropdownMenuContent align="end" onClick={(event) => event.stopPropagation()}><DropdownMenuItem disabled={!controller.active_workspace_id} onClick={() => void controller.create_session(controller.active_workspace_id, agent.agent_id)}><TbMessageCircle /><span>新对话</span></DropdownMenuItem><DropdownMenuItem onClick={() => void navigator.clipboard.writeText(agent.agent_id)}><TbCopy /><span>复制 Agent ID</span></DropdownMenuItem></DropdownMenuContent></DropdownMenu>
        </div>;
      })}
      {!controller.loading && controller.agents.length === 0 ? <div className="px-3 py-8 text-center text-xs text-muted-foreground">暂无 Agent</div> : null}
    </div>
  </div>;
}

/** 找到 Agent 当前最新的执行状态；没有执行时返回空字符串。 */
function get_agent_status_label(controller: DesktopViewController, agent_id: string): string | undefined {
  const sessions = Object.entries(controller.sessions_by_workspace)
    .flatMap(([workspace_id, sessions]) => sessions.map((item) => ({ workspace_id, item })))
    .filter(({ item }) => item.agent_id === agent_id);
  const latest_session = sessions
    .filter(({ workspace_id, item }) => item.session.executing || is_chat_busy(controller.chat_runtime_by_session[get_session_key(workspace_id, agent_id, item.session.session_id)]))
    .sort((left, right) => right.item.session.updated_at - left.item.session.updated_at)[0];
  if (!latest_session) return undefined;
  const runtime = controller.chat_runtime_by_session[get_session_key(latest_session.workspace_id, agent_id, latest_session.item.session.session_id)];
  if (runtime?.status === "waiting_input") return "等待输入";
  if (runtime?.status === "streaming") return "正在思考";
  return "正在提交";
}
