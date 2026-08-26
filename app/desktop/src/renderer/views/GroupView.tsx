/** 运行时 Group 共享消息视图，保持与 Agent Session Chat 一致的视觉结构。 */

import { useEffect, useRef, useState } from "react";
import { TbPlayerStop, TbPlus, TbSend, TbTrash, TbUsers } from "react-icons/tb";
import { Button } from "@/components/ui/button";
import { MainViewBody, MainViewLayout } from "@/layouts/MainViewLayout";
import { ChatMarkdown } from "@/lib/chat/ChatMarkdown";
import type { DesktopGroupMemberRuntime, DesktopGroupMessage, DesktopGroupSummary, DesktopWorkspaceSummary } from "@common/types/DesktopApi";

interface GroupViewProps {
  /** 当前运行时 Group。 */
  group: DesktopGroupSummary;
  /** 当前可选 Workspace。 */
  workspaces: DesktopWorkspaceSummary[];
  /** 当前共享消息。 */
  messages: DesktopGroupMessage[];
  /** 当前 GroupSession 的成员运行态。 */
  member_statuses: DesktopGroupMemberRuntime[];
  /** 向 Group 发送文本。 */
  send_message(text: string): Promise<string | undefined>;
  /** 停止 Group 当前执行。 */
  stop_session(): Promise<void>;
  /** 切换当前 GroupSession。 */
  open_session(session_id: string): Promise<void>;
  /** 创建新的 GroupSession。 */
  create_session(workspace_id?: string): Promise<void>;
  /** 删除当前 GroupSession。 */
  remove_session(session_id: string): Promise<void>;
}

/** Group 复用 Agent Chat 的消息流和输入区布局，但保留共享消息语义。 */
export function GroupView({ group, workspaces, messages, member_statuses, send_message, stop_session, open_session, create_session, remove_session }: GroupViewProps) {
  const scroll_ref = useRef<HTMLDivElement | null>(null);
  const [draft, set_draft] = useState("");
  const [sending, set_sending] = useState(false);
  const active_summary = group.sessions.find((session) => session.session_id === group.active_session_id);
  const [workspace_id, set_workspace_id] = useState(active_summary?.workspace_id || "");

  useEffect(() => {
    const container = scroll_ref.current;
    if (container) container.scrollTop = container.scrollHeight;
  }, [messages]);

  useEffect(() => {
    set_workspace_id(active_summary?.workspace_id || "");
  }, [active_summary?.workspace_id]);

  const submit = async () => {
    const text = draft.trim();
    if (!text || sending) return;
    set_sending(true);
    try {
      await send_message(text);
      set_draft("");
    } finally {
      set_sending(false);
    }
  };

  return <MainViewLayout>
    <header className="header-drag-region flex h-10 w-full flex-none items-center gap-2 px-2">
      <div className="flex min-w-0 flex-1 items-center gap-2 pl-1"><TbUsers className="size-4 shrink-0 text-muted-foreground" /><div className="min-w-0 truncate text-xs font-medium text-foreground">{group.name}</div><select aria-label="选择 GroupSession" value={group.active_session_id ?? ""} onChange={(event) => void open_session(event.target.value)} className="h-7 max-w-48 rounded-md border border-border bg-background px-1 text-[0.6875rem] text-foreground"><option value="" disabled>选择会话</option>{group.sessions.map((session) => <option key={session.session_id} value={session.session_id}>{new Date(session.updated_at).toLocaleString()} ({session.message_count})</option>)}</select><select aria-label="选择 Workspace" value={workspace_id} onChange={(event) => set_workspace_id(event.target.value)} className="h-7 max-w-40 rounded-md border border-border bg-background px-1 text-[0.6875rem] text-foreground"><option value="">内存</option>{workspaces.map((workspace) => <option key={workspace.workspace_id} value={workspace.workspace_id}>{workspace.name}</option>)}</select><Button size="icon" title="新建会话" aria-label="新建会话" onClick={() => void create_session(workspace_id || undefined)}><TbPlus /></Button>{group.active_session_id && group.sessions.length > 1 ? <Button size="icon" title="删除当前会话" aria-label="删除当前会话" onClick={() => void remove_session(group.active_session_id!)}><TbTrash /></Button> : null}</div>
      <div className="flex items-center gap-1">{member_statuses.filter((status) => status.running).map((status) => <span key={status.agent_id} className="text-[0.6875rem] text-muted-foreground">{status.agent_id} 执行中</span>)}<Button size="icon" title="停止执行" aria-label="停止执行" onClick={() => void stop_session()}><TbPlayerStop /></Button></div>
    </header>
    <MainViewBody>
      <div className="relative flex min-h-0 min-w-0 w-full flex-1 flex-col overflow-hidden bg-transparent">
        <div ref={scroll_ref} className="relative min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto" role="log">
          <div className="mx-auto flex min-h-full min-w-0 w-full max-w-[840px] flex-col p-2">
            {messages.length === 0 ? <div className="flex min-h-[50vh] flex-col items-center justify-center gap-3 px-4"><TbUsers className="size-8 text-muted-foreground/50" /><p className="text-center text-sm text-muted-foreground">开始与 {group.name} 协作</p><p className="text-center text-xs text-muted-foreground/60">{group.members.length} 个 Agent 已加入</p></div> : null}
            {messages.map((message) => <GroupMessageRow key={message.message_id} message={message} />)}
          </div>
        </div>
        <div className="mx-auto m-2 flex w-[calc(100%-1rem)] max-w-[840px] flex-none flex-col gap-2"><div className="rounded-2xl bg-muted-foreground/10"><div className="relative flex w-full min-w-0 flex-none flex-col gap-2 p-1"><textarea value={draft} onChange={(event) => set_draft(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void submit(); } }} placeholder="输入消息，发送给 Group…" className="chat-input-editor min-h-20 w-full resize-none border-0 bg-transparent px-3 py-2 text-sm outline-none" rows={2} /><div className="flex items-center justify-end gap-1 px-1 pb-1"><Button size="icon" title="发送" aria-label="发送" disabled={!draft.trim() || sending} onClick={() => void submit()}><TbSend /></Button></div></div></div></div>
      </div>
    </MainViewBody>
  </MainViewLayout>;
}

/** 按 Agent Chat 的左右消息结构渲染 Group 共享消息。 */
function GroupMessageRow({ message }: { /** Group 共享消息。 */ message: DesktopGroupMessage }) {
  if (message.author_type === "user") return <div className="group is-user flex w-full items-end justify-end gap-2 py-2"><div className="w-full flex justify-end"><div className="user-message-stack flex w-fit max-w-[min(80%,42rem)] min-w-0 flex-col items-end gap-0.5"><div className="ml-auto flex max-w-full flex-col gap-2 overflow-hidden rounded-2xl rounded-tr-none bg-muted-foreground/10 px-3 py-2 text-sm text-foreground"><div className="whitespace-pre-wrap break-words text-[0.8125rem] leading-[1.54]">{message.text}</div></div></div></div></div>;
  if (message.author_type === "system") return <div className="flex w-full items-center gap-3 py-2"><span className="h-px min-w-4 flex-1 bg-border/60" /><span className="max-w-[80%] text-center text-[0.75rem] text-muted-foreground">{message.text}</span><span className="h-px min-w-4 flex-1 bg-border/60" /></div>;
  return <div className="group is-assistant flex min-w-0 w-full items-start gap-2 py-2"><div className="size-8 shrink-0 rounded-full bg-foreground/[0.06] p-1.5 text-muted-foreground"><TbUsers className="size-full" /></div><div className="min-w-0 flex-1 px-1 pt-0.5 text-sm text-foreground"><div className="mb-1 text-[0.6875rem] font-medium text-muted-foreground">{message.author_id || "Agent"}</div><ChatMarkdown text={message.text} mode="static" class_name="text-[0.8125rem] leading-[1.54]" /></div></div>;
}
