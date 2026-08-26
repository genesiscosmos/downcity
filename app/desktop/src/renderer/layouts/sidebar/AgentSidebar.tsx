/** Agent 集合 Sidebar。 */

import { useEffect, useState } from "react";
import { TbCopy, TbDots, TbEdit, TbMessageCircle, TbPlus, TbTrash, TbUsers } from "react-icons/tb";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown";
import { AgentAvatar } from "@/components/AgentAvatar";
import { cn } from "@/lib/utils";
import { get_session_key, is_chat_busy, type DesktopViewController } from "@/types/DesktopView";
import type { DesktopCreateGroupInput, DesktopGroupSummary, DesktopUpdateGroupInput } from "@common/types/DesktopApi";

/** Agent Sidebar 属性。 */
interface AgentSidebarProps { /** 根状态控制器。 */ controller: DesktopViewController; /** 打开创建表单。 */ open_create_agent(): void; }

/** 展示扁平 Agent 列表和创建入口。 */
export function AgentSidebar({ controller, open_create_agent }: AgentSidebarProps) {
  const [create_group_open, set_create_group_open] = useState(false);
  const [editing_group, set_editing_group] = useState<DesktopGroupSummary | null>(null);
  const open_group = async (group_id: string) => {
    if (controller.groups_by_id[group_id]) {
      await controller.select_group(group_id);
      return;
    }
    await controller.open_group(group_id);
  };
  return <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
    <div className="flex h-9 shrink-0 items-center gap-2 px-2">
      <span className="min-w-0 flex-1 truncate px-1 text-xs font-medium text-muted-foreground">联系人</span>
      <DropdownMenu><DropdownMenuTrigger asChild><Button size="icon" title="添加联系人" aria-label="添加联系人"><TbPlus /></Button></DropdownMenuTrigger><DropdownMenuContent align="end" sideOffset={4}><DropdownMenuItem onClick={open_create_agent}><TbMessageCircle /><span>创建 Agent</span></DropdownMenuItem><DropdownMenuItem onClick={() => set_create_group_open(true)}><TbUsers /><span>创建 Group</span></DropdownMenuItem></DropdownMenuContent></DropdownMenu>
    </div>
    <div data-sidebar-scrollable="true" className="sidebar-body-scroll min-h-0 flex-1 space-y-1 overflow-y-auto px-2 pb-2">
      {controller.agents.map((agent) => {
        const active = controller.selection?.kind === "agent" && controller.selection.agent_id === agent.agent_id;
        const status_label = get_agent_status_label(controller, agent.agent_id);
        const model_label = controller.models.find((model) => model.model_id === agent.model_id)?.name || agent.model_id || "未配置模型";
        return <div key={agent.agent_id} role="button" tabIndex={0} className={cn("group relative flex min-h-12 w-full cursor-pointer items-center gap-2 rounded-lg border border-transparent px-1.5 py-1 transition-all duration-200", active ? "bg-primary/[0.1] hover:bg-primary/[0.12]" : "hover:bg-foreground/[0.07]")} onClick={() => void controller.open_agent_chat(agent.agent_id)}>
          <AgentAvatar agent={agent} class_name="size-8" /><span className="min-w-0 flex-1"><span className="block truncate text-xs font-medium text-foreground">{agent.agent_id}</span><span className={cn("mt-0.5 block truncate text-[10px]", status_label ? "text-primary" : "text-muted-foreground/70")}>{status_label || model_label}</span></span>
          <DropdownMenu><DropdownMenuTrigger asChild><Button size="icon" className="opacity-0 group-hover:opacity-100 data-[state=open]:opacity-100" onClick={(event) => event.stopPropagation()}><TbDots /></Button></DropdownMenuTrigger><DropdownMenuContent align="end" onClick={(event) => event.stopPropagation()}><DropdownMenuItem disabled={!controller.active_workspace_id} onClick={() => void controller.create_session(controller.active_workspace_id, agent.agent_id)}><TbMessageCircle /><span>新对话</span></DropdownMenuItem><DropdownMenuItem onClick={() => void navigator.clipboard.writeText(agent.agent_id)}><TbCopy /><span>复制 Agent ID</span></DropdownMenuItem></DropdownMenuContent></DropdownMenu>
        </div>;
      })}
      {controller.groups.map((group) => <div key={group.group_id} className={cn("group relative flex min-h-12 w-full items-center gap-2 rounded-lg border border-transparent px-1.5 py-1 text-left text-xs transition-colors", controller.selection?.kind === "group" && controller.selection.group_id === group.group_id ? "bg-primary/[0.1]" : "hover:bg-foreground/[0.07]")}><button type="button" className="flex min-w-0 flex-1 items-center gap-2 text-left" onClick={() => void open_group(group.group_id)}><TbUsers className="size-8 shrink-0 rounded-full bg-foreground/[0.06] p-2 text-muted-foreground" /><span className="min-w-0 flex-1"><span className="block truncate font-medium text-foreground">{group.name}</span><span className="mt-0.5 block truncate text-[10px] text-muted-foreground/70">{group.members.length} 个成员</span></span><span className="text-[0.625rem] text-muted-foreground/70">{group.message_count}</span></button><DropdownMenu><DropdownMenuTrigger asChild><Button size="icon" className="opacity-0 group-hover:opacity-100 data-[state=open]:opacity-100" title="Group 操作" aria-label="Group 操作" onClick={(event) => event.stopPropagation()}><TbDots /></Button></DropdownMenuTrigger><DropdownMenuContent align="end" onClick={(event) => event.stopPropagation()}><DropdownMenuItem onClick={() => set_editing_group(group)}><TbEdit /><span>编辑 Group</span></DropdownMenuItem><DropdownMenuItem className="text-destructive" onClick={() => { if (window.confirm(`确定删除 Group「${group.name}」吗？`)) void controller.remove_group(group.group_id); }}><TbTrash /><span>删除 Group</span></DropdownMenuItem></DropdownMenuContent></DropdownMenu></div>)}
      {!controller.loading && controller.agents.length === 0 && controller.groups.length === 0 ? <div className="px-3 py-8 text-center text-xs text-muted-foreground">暂无联系人</div> : null}
    </div>
    <GroupEditorDialog open={create_group_open} close_dialog={() => set_create_group_open(false)} agents={controller.agents} create_group={controller.create_group} />
    <GroupEditorDialog open={Boolean(editing_group)} close_dialog={() => set_editing_group(null)} group={editing_group || undefined} agents={controller.agents} update_group={controller.update_group} />
  </div>;
}

/** 创建运行时 Group 的最小配置对话框。 */
function GroupEditorDialog({ open, close_dialog, group, agents, create_group, update_group }: { open: boolean; close_dialog(): void; group?: DesktopGroupSummary; agents: DesktopViewController["agents"]; create_group?: (input: DesktopCreateGroupInput) => Promise<void>; update_group?: (group_id: string, input: DesktopUpdateGroupInput) => Promise<void> }) {
  const [group_id, set_group_id] = useState("");
  const [name, set_name] = useState("");
  const [instruction, set_instruction] = useState("");
  const [member_agent_ids, set_member_agent_ids] = useState<string[]>([]);
  useEffect(() => {
    set_group_id(group?.group_id || "");
    set_name(group?.name || "");
    set_instruction(group?.instruction || "");
    set_member_agent_ids(group?.members.map((member) => member.agent_id) || []);
  }, [group, open]);
  const submit = async () => {
    if ((!group_id.trim() && !group) || member_agent_ids.length === 0) return;
    if (group && update_group) await update_group(group.group_id, { name: name.trim() || group.group_id, instruction, member_agent_ids });
    else if (create_group) await create_group({ group_id: group_id.trim(), name: name.trim() || group_id.trim(), instruction, member_agent_ids });
    set_group_id("");
    set_name("");
    set_instruction("");
    set_member_agent_ids([]);
    close_dialog();
  };
  return <Dialog open={open} onOpenChange={(value) => { if (!value) close_dialog(); }}><DialogContent><DialogHeader><DialogTitle>{group ? "编辑 Group" : "创建 Group"}</DialogTitle><DialogDescription>{group ? "修改 Group 的名称、目标和成员。" : "选择成员后创建 Group。"}</DialogDescription></DialogHeader><DialogBody className="space-y-3 px-3 pb-3">{group ? <div className="rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">ID：{group.group_id}</div> : <input value={group_id} onChange={(event) => set_group_id(event.target.value)} placeholder="Group ID" className="h-9 w-full rounded-md border border-border bg-background px-3 text-sm" />}<input value={name} onChange={(event) => set_name(event.target.value)} placeholder="Group 名称" className="h-9 w-full rounded-md border border-border bg-background px-3 py-2 text-sm" /><textarea value={instruction} onChange={(event) => set_instruction(event.target.value)} placeholder="协作目标（可选）" className="min-h-20 w-full resize-none border border-border bg-background px-3 py-2 text-sm" /><div className="space-y-1">{agents.map((agent) => <label key={agent.agent_id} className="flex items-center gap-2 rounded-md px-2 py-1.5 text-xs hover:bg-muted"><input type="checkbox" checked={member_agent_ids.includes(agent.agent_id)} onChange={(event) => set_member_agent_ids((current) => event.target.checked ? [...current, agent.agent_id] : current.filter((item) => item !== agent.agent_id))} />{agent.agent_id}</label>)}</div><div className="flex justify-end gap-2"><Button variant="default" onClick={close_dialog}>取消</Button><Button variant="primary" disabled={(!group && !group_id.trim()) || member_agent_ids.length === 0} onClick={() => void submit()}>{group ? "保存" : "创建"}</Button></div></DialogBody></DialogContent></Dialog>;
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
