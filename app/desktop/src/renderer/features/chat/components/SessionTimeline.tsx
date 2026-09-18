/** Downcity Session Chat 主视图与页面级滚动、空状态和 Composer 组合。 */

import { useCallback, useRef, type MouseEvent, type ReactNode } from "react";
import type { RespondSessionInteractionInput, SessionMessage, SessionTurnFileDiffSummary } from "@downcity/agent";
import { TbAlertTriangle, TbCheck, TbChevronDown, TbDots, TbEdit, TbFolder } from "react-icons/tb";
import { Button } from "@/components/ui/button";
import { AgentAvatar } from "@/components/AgentAvatar";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown";
import { use_open_agent_config } from "@/features/agent/components/AgentChatDetails";
import { ChatSurfaceLayout } from "@/features/chat/components/ChatLayout";
import { ChatTextSelectionQuote } from "@/features/chat/components/ChatTextSelectionQuote";
import { ChatWorkspaceSelector } from "@/features/chat/components/ChatWorkspaceSelector";
import { JumpToLatest } from "@/features/chat/components/JumpToLatest";
import { SessionActionsMenu } from "@/features/chat/components/SessionActionsMenu";
import { SessionMessageList } from "@/features/chat/components/SessionMessageList";
import { TurnFileOpenProvider } from "@/features/chat/components/messages/TurnFileDiffCard";
import { WorkspaceTagMenu } from "@/features/chat/components/WorkspaceTagMenu";
import { get_session_key } from "@/features/chat/lib/chat_cache_key";
import { resolve_workspace_file_link } from "@/features/navigation/lib/desktop_link";
import { resolve_chat_follow_indicator } from "@/features/chat/lib/chat_scroll";
import { use_chat_scroll } from "@/features/chat/lib/use_chat_scroll";
import { use_baybar_open } from "@/layouts/BayBar";
import { use_translation } from "@/locales/i18n";
import { is_chat_busy, type ChatHistoryState } from "@/types/DesktopView";
import type { DesktopAgentSummary, DesktopChatRewriteInput, DesktopChatRuntime, DesktopSessionSummary, DesktopSettings, DesktopWorkspaceSummary } from "@common/types/DesktopApi";

/** Session Chat 主视图属性。 */
interface SessionViewProps {
  /** 当前 Chat 的 UI 表面。 */
  chat_surface?: "agent" | "workspace";
  /** 当前 Workspace 稳定标识。 */
  workspace_id: string;
  /** Session 所属 Agent。 */
  agent: DesktopAgentSummary;
  /** Session 所属 Workspace。 */
  workspace: DesktopWorkspaceSummary;
  /** 当前 Session 关联的 Workspace 已从 Registry 移除。 */
  workspace_missing?: boolean;
  /** 可切换的全部 Workspace。 */
  workspaces: DesktopWorkspaceSummary[];
  /** 当前是否为尚未创建的 Session 草稿。 */
  workspace_draft_mode?: boolean;
  /** 在目标 Workspace 开启新对话。 */
  switch_workspace(workspace_id: string): Promise<void> | void;
  /** 可切换的全部 Agent。 */
  agents: DesktopAgentSummary[];
  /** 当前 Session 摘要。 */
  session: DesktopSessionSummary;
  /** 当前 Session 的 canonical 可见消息。 */
  messages: SessionMessage[];
  /** 当前 Session 实时运行态。 */
  runtime?: DesktopChatRuntime;
  /** 当前 Session 最新实时文件改动摘要。 */
  file_diff_by_session?: SessionTurnFileDiffSummary;
  /** 在右侧面板打开指定相对路径文件；不提供时链接交回 Shell 处理。 */
  open_file?(relative_path: string, line?: number): void;
  /** 当前 Session 更早历史分页状态。 */
  history?: ChatHistoryState;
  /** Desktop Chat 设置。 */
  settings: DesktopSettings;
  /** 修改当前 Session 标题。 */
  rename_session?(title: string): Promise<void>;
  /** 归档当前 Session。 */
  archive_session?(): Promise<void>;
  /** 删除当前 Session。 */
  remove_session?(): Promise<void>;
  /** 切换新建 Chat 的 Workspace 或 Agent。 */
  switch_draft_context(workspace_id: string, agent_id: string): void;
  /** 当前场景自己的输入区域。 */
  composer: ReactNode;
  /** 响应当前审批或问题。 */
  respond_interaction?(input: RespondSessionInteractionInput): Promise<void>;
  /** 从指定消息创建并打开分支 Session。 */
  fork_message?(message_id: string): Promise<void>;
  /** 重写指定历史用户消息。 */
  rewrite_message?(input: DesktopChatRewriteInput): Promise<void>;
  /** 当前 Session 没有待发送队列，可以执行替换事务。 */
  can_replace_session?: boolean;
  /** 读取一个更早历史 Segment。 */
  load_earlier_history?(): Promise<void>;
}

/** 草稿没有历史消息能力；仅作为消息渲染器的内部空实现。 */async function ignore_unavailable_history_action(): Promise<void> {}

/** Session 对话主视图。 */
export function SessionView(props: SessionViewProps) {
  const translate_chat = use_translation("chat");
  const { session, messages, runtime, settings } = props;
  const scroll_surface_id = get_session_key(props.workspace_id, props.agent.agent_id, session.session_id);
  // 滚动锚点以「首条消息 ID」为内容标识：只有历史前插会改变它，追加消息不会。
  const { scroll_ref, content_ref, handle_scroll, preserve_prepend_position, is_following, latest_visible, scroll_to_bottom } = use_chat_scroll(scroll_surface_id, settings.auto_scroll, messages[0]?.message_id ?? "");
  const busy = is_chat_busy(runtime);
  // 「回到最新」的计数基线：仍在底部时基线跟着当前消息数走，离开底部后才开始累积。
  // 这样用户只是上滑回看、没有新内容时不会报出一个凭空的数字。
  // 基线由**跟随状态**驱动（“什么时候离开底部”是意图），而入口的显隐由**距离**决定，
  // 两者分开见 resolve_chat_follow_indicator。
  const follow_baseline_ref = useRef(props.messages.length);
  if (is_following) follow_baseline_ref.current = props.messages.length;
  const follow_indicator = resolve_chat_follow_indicator({
    latest_visible,
    baseline_message_count: follow_baseline_ref.current,
    message_count: props.messages.length,
  });
  const handle_link_click = useCallback((event: MouseEvent<HTMLDivElement>) => {
    if (!props.open_file || event.defaultPrevented || event.button !== 0) return;
    const anchor = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>("a[href]") : null;
    const target = anchor?.getAttribute("href");
    if (!target) return;
    const file = resolve_workspace_file_link(target, props.workspaces, props.workspace_id);
    // 其它链接（外链、系统文件、跨 Workspace）不在此收口，继续由 Shell 的统一路由处理。
    if (!file) return;
    event.preventDefault();
    props.open_file(file.relative_path, file.line);
  }, [props.open_file, props.workspace_id, props.workspaces]);
  const load_earlier = () => props.load_earlier_history ? preserve_prepend_position(props.load_earlier_history) : Promise.resolve();
  const workspace_tag = props.workspace_missing
    ? <span className="inline-flex h-5 max-w-40 shrink-0 items-center gap-1 rounded-full bg-amber-500/10 px-2 text-3xs font-normal text-amber-600 dark:text-amber-400"><TbAlertTriangle className="size-3 shrink-0" /><span className="truncate">{translate_chat("message.workspace_missing")}</span></span>
    : props.workspace_draft_mode
      ? <ChatWorkspaceSelector workspace_id={props.workspace_id} workspaces={props.workspaces} disabled={busy} switch_workspace={props.switch_workspace} />
      : <WorkspaceTagMenu workspace={props.workspace} />;
  const session_title = session.title || translate_chat("conversation.new");

  return <ChatSurfaceLayout
    header_left={<div className="flex min-w-0 max-w-[min(100%,36rem)] items-center gap-2"><span className="min-w-0 truncate text-xs font-medium text-foreground" title={session_title}>{session_title}</span>{workspace_tag}</div>}
    header_right={props.rename_session && props.archive_session && props.remove_session ? <div className="flex shrink-0 items-center gap-1"><SessionActionsMenu session={session} on_rename={props.rename_session} on_archive={props.archive_session} on_remove={props.remove_session} trigger={<Button size="icon" title={translate_chat("conversation.actions")} aria-label={translate_chat("conversation.actions")}><TbDots /></Button>} /></div> : null}
  >
    <div className="relative flex min-h-0 min-w-0 w-full flex-1 flex-col overflow-hidden bg-transparent">
      {/* 视口外层保持 relative，供「回到最新」浮在列表底部之上、又不被滚动带走。 */}
      <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
      <div ref={scroll_ref} className="chat-scroll-viewport relative min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto" role="log" aria-busy={busy} onClick={handle_link_click} onScroll={handle_scroll}>
        <ChatTextSelectionQuote container_ref={scroll_ref} session_id={session.session_id} />
        <div ref={content_ref} className="chat-scroll-content mx-auto flex min-h-full min-w-0 w-full max-w-[840px] flex-col p-2">
          {messages.length === 0 ? <EmptyPrompts surface={props.chat_surface} agent={props.agent} workspace={props.workspace} workspaces={props.workspaces} agents={props.agents} switch_context={props.switch_draft_context} /> : null}
          <TurnFileOpenProvider open_file={props.open_file} workspace_path={props.workspace.workspace_path || undefined}><SessionMessageList session_id={session.session_id} messages={messages} agent={props.agent} show_reasoning={settings.show_reasoning} respond_interaction={props.respond_interaction ?? ignore_unavailable_history_action} fork_message={props.fork_message ?? ignore_unavailable_history_action} rewrite_message={props.rewrite_message} file_diff={props.file_diff_by_session} runtime={busy ? runtime : undefined} history={props.history} load_earlier_history={props.load_earlier_history ? load_earlier : undefined} can_use_history_actions={!busy} can_replace_session={props.can_replace_session ?? true} /></TurnFileOpenProvider>
        </div>
      </div>
        <JumpToLatest visible={follow_indicator.visible && messages.length > 0} new_message_count={follow_indicator.new_message_count} on_click={scroll_to_bottom} />
      </div>
      <div className="flex w-full flex-none flex-col">{props.composer}</div>
    </div>
  </ChatSurfaceLayout>;
}

/** 空会话提示。 */
function EmptyPrompts({ surface = "workspace", agent, workspace, workspaces, agents, switch_context }: { /** 当前 Chat 表面。 */ surface?: "agent" | "workspace"; /** 当前联系人 Agent。 */ agent: DesktopAgentSummary; /** 当前 Workspace。 */ workspace: DesktopWorkspaceSummary; /** 可切换 Workspace。 */ workspaces: DesktopWorkspaceSummary[]; /** 可切换 Agent。 */ agents: DesktopAgentSummary[]; /** 切换新对话上下文。 */ switch_context(workspace_id: string, agent_id: string): void }) {
  const translate_chat = use_translation("chat");
  const open_agent_config = use_open_agent_config();
  if (surface === "workspace") return <div className="flex min-h-[50vh] items-center justify-center px-4"><NewChatContextSelector workspace={workspace} workspaces={workspaces} agent={agent} agents={agents} switch_context={switch_context} /></div>;
  // 头像即 Agent 配置入口：正文里的入口通过 BayBar context 打开右侧「Agent」域。
  const open_agent_config_label = translate_chat("conversation.open_agent_config", { name: agent.name });
  const agent_description = agent.description?.trim();
  return <div className="flex min-h-[56vh] flex-col items-center justify-center px-4"><div className="flex flex-col items-center gap-2.5"><button type="button" onClick={() => open_agent_config?.()} title={open_agent_config_label} aria-label={open_agent_config_label} className="group relative shrink-0 cursor-pointer rounded-avatar p-0 outline-none focus-visible:ring-2 focus-visible:ring-ring/40"><AgentAvatar agent={agent} class_name="size-14" icon_class_name="size-7" /><span aria-hidden="true" className="absolute inset-0 flex items-center justify-center rounded-avatar bg-foreground/40 opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-visible:opacity-100"><TbEdit className="size-5 text-background" /></span></button><div className="text-center text-base font-medium text-foreground">{agent.name}</div></div>{agent_description ? <p title={agent_description} className="mt-2.5 line-clamp-2 max-w-md text-center text-xs leading-5 text-muted-foreground">{agent_description}</p> : null}<div className={agent_description ? "mt-8" : "mt-10"}><ChatWorkspaceSelector workspace_id={workspace.workspace_id} workspaces={workspaces} disabled={false} variant="field" switch_workspace={(workspace_id) => switch_context(workspace_id, agent.agent_id)} /></div></div>;
}

/** 新建 Chat 输入框上方的当前上下文。 */
function NewChatContextSelector({ workspace, workspaces, agent, agents, switch_context }: { /** 当前 Workspace。 */ workspace: DesktopWorkspaceSummary; /** 可切换 Workspace。 */ workspaces: DesktopWorkspaceSummary[]; /** 当前 Agent。 */ agent: DesktopAgentSummary; /** 可切换 Agent。 */ agents: DesktopAgentSummary[]; /** 提交上下文切换。 */ switch_context(workspace_id: string, agent_id: string): void }) {
  const translate_chat = use_translation("chat");
  return <div className="flex min-w-0 max-w-full flex-col items-center gap-4">
    <DropdownMenu><DropdownMenuTrigger asChild><button type="button" className="group flex min-w-0 max-w-full flex-col items-center gap-2 rounded-surface px-5 py-3 outline-none transition-colors hover:bg-interaction-hover focus-visible:ring-2 focus-visible:ring-ring/30" aria-label={translate_chat("conversation.select_contact")}><AgentAvatar agent={agent} class_name="size-14" /><span className="flex max-w-64 items-center gap-1.5 text-lg font-medium text-foreground"><span className="truncate">{agent.name}</span><TbChevronDown className="size-4 shrink-0 text-muted-foreground transition-transform group-data-[popup-open]:rotate-180" /></span><span className="text-xs text-muted-foreground">{translate_chat("conversation.contact")}</span></button></DropdownMenuTrigger><DropdownMenuContent align="center" side="bottom" sideOffset={6}>{agents.map((item) => <DropdownMenuItem key={item.agent_id} is_selected={item.agent_id === agent.agent_id} onClick={() => switch_context(workspace.workspace_id, item.agent_id)}><AgentAvatar agent={item} class_name="size-5" /><span className="min-w-0 flex-1 truncate">{item.name}</span>{item.agent_id === agent.agent_id ? <TbCheck className="size-3.5 text-primary" /> : null}</DropdownMenuItem>)}</DropdownMenuContent></DropdownMenu>
    <DropdownMenu><DropdownMenuTrigger asChild><button type="button" className="flex min-w-0 max-w-72 items-center gap-2 rounded-control px-3 py-2 text-xs text-muted-foreground outline-none transition-colors hover:bg-interaction-hover hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/30" aria-label={translate_chat("conversation.select_workspace")}><TbFolder className="size-4 shrink-0" /><span className="truncate">{workspace.name}</span><TbChevronDown className="size-3.5 shrink-0" /></button></DropdownMenuTrigger><DropdownMenuContent align="center" side="bottom" sideOffset={6}>{workspaces.map((item) => <DropdownMenuItem key={item.workspace_id} is_selected={item.workspace_id === workspace.workspace_id} onClick={() => switch_context(item.workspace_id, agent.agent_id)}><TbFolder className="size-4" /><span className="min-w-0 flex-1 truncate">{item.name}</span>{item.workspace_id === workspace.workspace_id ? <TbCheck className="size-3.5 text-primary" /> : null}</DropdownMenuItem>)}</DropdownMenuContent></DropdownMenu>
    <span className="text-2xs text-muted-foreground">{translate_chat("message.choose_context")}</span>
  </div>;
}
