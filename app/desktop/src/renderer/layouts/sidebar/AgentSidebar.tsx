/** Agent 集合 Sidebar。 */

import { TbCopy, TbDots, TbMessageCircle } from "react-icons/tb";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown";
import { AgentAvatar } from "@/components/AgentAvatar";
import { cn } from "@/lib/utils";
import type { DesktopViewController } from "@/types/DesktopView";

/** Agent Sidebar 属性。 */
interface AgentSidebarProps { /** 根状态控制器。 */ controller: DesktopViewController; /** 打开创建表单。 */ open_create_agent(): void; }

/** 展示扁平 Agent 列表和创建入口。 */
export function AgentSidebar({ controller, open_create_agent }: AgentSidebarProps) {
  return <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
    <div data-sidebar-scrollable="true" className="sidebar-body-scroll min-h-0 flex-1 overflow-y-auto px-2 pb-2">
      {controller.agents.map((agent) => {
        const active = controller.selection?.kind === "agent" && controller.selection.agent_id === agent.agent_id;
        return <div key={agent.agent_id} role="button" tabIndex={0} className={cn("group relative flex min-h-8 w-full cursor-pointer items-center gap-2 rounded-lg border border-transparent p-0.5 pl-2 transition-all duration-200", active ? "bg-primary/[0.1] hover:bg-primary/[0.12]" : "hover:bg-foreground/[0.07]")} onClick={() => controller.select_agent(agent.agent_id)}>
          <AgentAvatar agent={agent} /><span className="min-w-0 flex-1 truncate text-xs text-foreground">{agent.agent_id}</span>
          <DropdownMenu><DropdownMenuTrigger asChild><Button size="icon" className="opacity-0 group-hover:opacity-100 data-[state=open]:opacity-100" onClick={(event) => event.stopPropagation()}><TbDots /></Button></DropdownMenuTrigger><DropdownMenuContent align="end" onClick={(event) => event.stopPropagation()}><DropdownMenuItem disabled={!controller.active_workspace_id} onClick={() => void controller.create_session(controller.active_workspace_id, agent.agent_id)}><TbMessageCircle /><span>新对话</span></DropdownMenuItem><DropdownMenuItem onClick={() => void navigator.clipboard.writeText(agent.agent_id)}><TbCopy /><span>复制 Agent ID</span></DropdownMenuItem></DropdownMenuContent></DropdownMenu>
        </div>;
      })}
      {!controller.loading && controller.agents.length === 0 ? <div className="px-3 py-8 text-center text-xs text-muted-foreground">暂无 Agent</div> : null}
    </div>
  </div>;
}
