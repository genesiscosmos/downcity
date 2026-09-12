/** Session canonical 消息列表的投影、性能边界与主体分发。 */

import { memo, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { RespondSessionInteractionInput, SessionMessage, SessionTurnFileDiffSummary } from "@downcity/agent";
import { TbArrowUp } from "react-icons/tb";
import { Button } from "@/components/ui/button";
import { ChatMessageViewportRow } from "@/features/chat/components/ChatMessageViewportRow";
import { AgentMessage } from "@/features/chat/components/messages/AgentMessage";
import { AgentRuntimeIndicator } from "@/features/chat/components/messages/AgentRuntimeIndicator";
import { UserMessage } from "@/features/chat/components/messages/UserMessage";
import { project_session_message_segments } from "@/features/chat/lib/session_message_projection";
import { use_translation } from "@/locales/i18n";
import type { ChatHistoryState } from "@/types/DesktopView";
import type { SessionMessageProjection, SessionMessageSegment as SessionMessageSegmentProjection } from "@/types/SessionProjection";
import type { DesktopAgentSummary, DesktopChatRewriteInput, DesktopChatRuntime } from "@common/types/DesktopApi";

/** 投影并渲染当前 Session 消息，同时保留分段、渐进挂载和单消息 memo 边界。 */
export function SessionMessageList({ session_id, messages, agent, show_reasoning, respond_interaction, fork_message, rewrite_message, file_diff, runtime, history, load_earlier_history, can_use_history_actions, can_replace_session }: { /** 当前 Session 稳定标识。 */ session_id: string; /** canonical 消息集合。 */ messages: SessionMessage[]; /** Session 所属 Agent。 */ agent: DesktopAgentSummary; /** 是否展示 Reasoning。 */ show_reasoning: boolean; /** 响应 Interaction。 */ respond_interaction(input: RespondSessionInteractionInput): Promise<void>; /** 从消息创建分支 Session。 */ fork_message(message_id: string): Promise<void>; /** 重写 User Message。 */ rewrite_message?(input: DesktopChatRewriteInput): Promise<void>; /** 最新实时文件改动摘要。 */ file_diff?: SessionTurnFileDiffSummary; /** 当前 Session 运行态。 */ runtime?: DesktopChatRuntime; /** 更早历史分页状态。 */ history?: ChatHistoryState; /** 在保持滚动位置的前提下加载更早历史。 */ load_earlier_history?(): Promise<void>; /** 当前是否允许历史操作。 */ can_use_history_actions: boolean; /** 当前 Session 是否允许替换。 */ can_replace_session: boolean }) {
  const translate_chat = use_translation("chat");
  const projection_ref = useRef<SessionMessageProjection | undefined>(undefined);
  const projection_session_id_ref = useRef(session_id);
  const projection = useMemo(() => {
    const previous = projection_session_id_ref.current === session_id ? projection_ref.current : undefined;
    const next = project_session_message_segments(messages, previous);
    projection_session_id_ref.current = session_id;
    projection_ref.current = next;
    return next;
  }, [messages, session_id]);

  return <>
    {history?.has_more && load_earlier_history ? <div className="flex justify-center py-1"><Button disabled={history.loading} onClick={() => void load_earlier_history()}><TbArrowUp />{translate_chat(history.loading ? "message.loading_earlier" : "message.load_earlier")}</Button></div> : null}
    <ProgressiveMessageSegments key={session_id} segments={projection.segments}>{(segment) => <SessionMessageSegment key={segment.segment_id} segment={segment} agent={agent} show_reasoning={show_reasoning} respond_interaction={respond_interaction} fork_message={fork_message} rewrite_message={rewrite_message} file_diff={segment.has_streaming_message ? file_diff : undefined} can_use_history_actions={can_use_history_actions} can_replace_session={can_replace_session} />}</ProgressiveMessageSegments>
    {runtime && !projection.has_streaming_message ? <AgentRuntimeIndicator agent={agent} status={runtime.status} file_diff={file_diff} /> : null}
  </>;
}

/** 按 discriminated union 穷尽分发一条 canonical Session Message。 */
const SessionMessageRow = memo(function SessionMessageRow({ message, agent, show_reasoning, respond_interaction, fork_message, rewrite_message, file_diff, has_later_visible_message, can_use_history_actions, can_replace_session }: { /** canonical 消息。 */ message: SessionMessage; /** 当前 Agent。 */ agent: DesktopAgentSummary; /** 是否显示推理。 */ show_reasoning: boolean; /** 响应 Interaction。 */ respond_interaction(input: RespondSessionInteractionInput): Promise<void>; /** 创建分支 Session。 */ fork_message(message_id: string): Promise<void>; /** 重写历史 User Message。 */ rewrite_message?(input: DesktopChatRewriteInput): Promise<void>; /** 当前流式消息的文件改动摘要。 */ file_diff?: SessionTurnFileDiffSummary; /** 当前消息之后是否仍有可见内容。 */ has_later_visible_message: boolean; /** 当前是否允许历史操作。 */ can_use_history_actions: boolean; /** 当前 Session 是否允许被替换。 */ can_replace_session: boolean }) {
  switch (message.role) {
    case "user": return <UserMessage message={message} fork_message={fork_message} rewrite_message={rewrite_message} has_later_visible_message={has_later_visible_message} can_use_history_actions={can_use_history_actions} can_replace_session={can_replace_session} />;
    case "agent": return <AgentMessage message={message} agent={agent} show_reasoning={show_reasoning} respond_interaction={respond_interaction} fork_message={fork_message} file_diff={file_diff} />;
    default: return assert_never(message);
  }
}, (previous, next) => previous.message === next.message
  && previous.agent === next.agent
  && previous.show_reasoning === next.show_reasoning
  && previous.respond_interaction === next.respond_interaction
  && previous.fork_message === next.fork_message
  && previous.rewrite_message === next.rewrite_message
  && previous.file_diff === next.file_diff
  && previous.has_later_visible_message === next.has_later_visible_message
  && previous.can_use_history_actions === next.can_use_history_actions
  && previous.can_replace_session === next.can_replace_session);

/** 一个稳定 sequence 区间的消息渲染边界。 */
const SessionMessageSegment = memo(function SessionMessageSegment({ segment, agent, show_reasoning, respond_interaction, fork_message, rewrite_message, file_diff, can_use_history_actions, can_replace_session }: { /** 稳定消息分段。 */ segment: SessionMessageSegmentProjection; /** 当前 Agent。 */ agent: DesktopAgentSummary; /** 是否显示推理。 */ show_reasoning: boolean; /** 响应 Interaction。 */ respond_interaction(input: RespondSessionInteractionInput): Promise<void>; /** 创建分支 Session。 */ fork_message(message_id: string): Promise<void>; /** 重写历史 User Message。 */ rewrite_message?(input: DesktopChatRewriteInput): Promise<void>; /** 当前流式消息的文件改动摘要。 */ file_diff?: SessionTurnFileDiffSummary; /** 当前是否允许历史操作。 */ can_use_history_actions: boolean; /** 当前 Session 是否允许被替换。 */ can_replace_session: boolean }) {
  return <>{segment.rows.map(({ message, has_later_visible_message }) => <ChatMessageViewportRow key={message.message_id} row_id={message.message_id} active={message.role === "agent" && message.state === "streaming"}><SessionMessageRow message={message} agent={agent} show_reasoning={show_reasoning} respond_interaction={respond_interaction} fork_message={fork_message} rewrite_message={rewrite_message} file_diff={message.role === "agent" && message.state === "streaming" ? file_diff : undefined} has_later_visible_message={has_later_visible_message} can_use_history_actions={can_use_history_actions} can_replace_session={can_replace_session} /></ChatMessageViewportRow>)}</>;
}, (previous, next) => previous.segment === next.segment
  && previous.agent === next.agent
  && previous.show_reasoning === next.show_reasoning
  && previous.respond_interaction === next.respond_interaction
  && previous.fork_message === next.fork_message
  && previous.rewrite_message === next.rewrite_message
  && previous.can_use_history_actions === next.can_use_history_actions
  && previous.can_replace_session === next.can_replace_session
  && (!next.segment.has_streaming_message || previous.file_diff === next.file_diff));

/** 切换 Session 时先挂载最新分段，再逐帧向前补齐历史。 */
function ProgressiveMessageSegments({ segments, children }: { /** 按时间排序的消息分段。 */ segments: readonly SessionMessageSegmentProjection[]; /** 渲染一个已进入视图树的分段。 */ children(segment: SessionMessageSegmentProjection): ReactNode }) {
  const [first_visible_segment_id, set_first_visible_segment_id] = useState<number>();
  const stored_start_index = first_visible_segment_id === undefined ? -1 : segments.findIndex((segment) => segment.segment_id === first_visible_segment_id);
  const start_index = stored_start_index >= 0 ? stored_start_index : Math.max(0, segments.length - 1);
  const next_segment_id = start_index > 0 ? segments[start_index - 1]?.segment_id : undefined;
  useEffect(() => {
    if (next_segment_id === undefined) return;
    const timer = window.setTimeout(() => set_first_visible_segment_id(next_segment_id), 24);
    return () => window.clearTimeout(timer);
  }, [next_segment_id]);
  return <>{segments.slice(start_index).map(children)}</>;
}

function assert_never(value: never): never { throw new Error(`不支持的 Session Message：${String((value as { role?: unknown }).role)}`); }
