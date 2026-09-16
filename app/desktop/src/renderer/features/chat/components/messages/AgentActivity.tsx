/** Agent Message 中连续 Reasoning、Tool 与 Action 的活动展示。 */

import { useEffect, useState, type ComponentType, type ReactNode } from "react";
import type { RespondSessionInteractionInput, SessionAgentActionPart, SessionAgentReasoningPart, SessionAgentToolPart } from "@downcity/agent";
import { TbArrowsMinimize, TbBulb, TbChevronRight, TbCommand, TbFilePencil, TbFilePlus, TbFileSearch, TbGitFork, TbMessageQuestion, TbPuzzle, TbSearch, TbTerminal2, TbTextScan2 } from "react-icons/tb";
import { AgentInteraction } from "@/features/chat/components/messages/AgentInteraction";
import { resolve_agent_action_presentation, resolve_agent_tool_presentation, select_activity_summary_part, should_auto_open_agent_activity, should_auto_open_agent_tool } from "@/features/chat/lib/message/agent_activity_presentation";
import type { AgentActivityDetail, AgentActivityEditPair, AgentActivityPart, AgentActivityPresentation, AgentActivityTone, AgentActivityVisualKind } from "@/features/chat/types/AgentMessage";
import { cn } from "@/lib/utils";
import { use_translation } from "@/locales/i18n";

/** 活动行图标；Reasoning、Tool 与 Action 共用一张表，新增种类由类型系统强制补全。 */
const AGENT_ACTIVITY_ICONS: Record<AgentActivityVisualKind, ComponentType<{ className?: string; "aria-hidden"?: boolean }>> = {
  reasoning: TbBulb,
  read: TbTextScan2,
  write: TbFilePlus,
  edit: TbFilePencil,
  grep: TbSearch,
  find: TbFileSearch,
  shell: TbTerminal2,
  ask: TbMessageQuestion,
  plugin: TbPuzzle,
  command: TbCommand,
  fork: TbGitFork,
  compaction: TbArrowsMinimize,
  generic: TbPuzzle,
};

/** 活动行语气到样式钩子的唯一映射。 */
const AGENT_ACTIVITY_TONE_CLASS: Record<AgentActivityTone, string> = {
  running: "is-running",
  complete: "is-complete",
  failed: "is-failed",
};

/**
 * 展示连续活动。Reasoning 显隐只改变可见项，不改变 canonical 活动块边界。
 * 零项不输出容器，一项直接显示，多项聚合为一个可展开日志。
 */
export function AgentActivity({ parts, show_reasoning, streaming, respond_interaction }: { parts: readonly AgentActivityPart[]; show_reasoning: boolean; streaming: boolean; respond_interaction(input: RespondSessionInteractionInput): Promise<void> }) {
  const visible_parts = parts.filter((part) => part.type !== "reasoning" || (show_reasoning && Boolean(part.text.trim())));
  if (visible_parts.length === 0) return null;
  return <div className="agent-process-body">
    {visible_parts.length === 1
      ? <AgentActivityItem part={visible_parts[0]} message_streaming={streaming} respond_interaction={respond_interaction} />
      : <AgentActivityGroup parts={visible_parts} message_streaming={streaming} respond_interaction={respond_interaction} />}
  </div>;
}

/** 多个连续活动共用的折叠摘要与展开状态。摘要始终取最后一个非 Reasoning 项。 */
function AgentActivityGroup({ parts, message_streaming, respond_interaction }: { parts: readonly AgentActivityPart[]; message_streaming: boolean; respond_interaction(input: RespondSessionInteractionInput): Promise<void> }) {
  const translate_chat = use_translation("chat");
  const summary_part = select_activity_summary_part(parts) ?? parts[parts.length - 1];
  // Interaction 属于 Tool Part；待响应时自动展开一次，方便用户直接回答。
  const pending_interaction_id = parts
    .flatMap((part) => part.type === "tool" ? (part.interactions ?? []) : [])
    .find((interaction) => interaction.status === "pending")?.interaction_id ?? "";
  return <ActivityRow
    {...summarize_activity(summary_part, message_streaming, translate_chat)}
    badge={`+${parts.length - 1}`}
    auto_open={should_auto_open_agent_activity(parts)}
    auto_open_key={pending_interaction_id}
    summary_class_name="activity-tool-group-summary"
    body={<div className="activity-tool-group-body">{parts.map((part, index) => <div key={part.part_id} className="activity-tool-log"><AgentActivityItem part={part} message_streaming={message_streaming && index === parts.length - 1} respond_interaction={respond_interaction} /></div>)}</div>}
  />;
}

/** 对单个 canonical 活动 Part 做穷尽分发。 */
function AgentActivityItem({ part, message_streaming, respond_interaction }: { part: AgentActivityPart; message_streaming: boolean; respond_interaction(input: RespondSessionInteractionInput): Promise<void> }) {
  switch (part.type) {
    case "reasoning": return <AgentReasoning part={part} message_streaming={message_streaming} />;
    case "tool": return <AgentTool part={part} respond_interaction={respond_interaction} />;
    case "action": return <AgentAction part={part} />;
    default: return assert_never(part);
  }
}

/** 可展开的 Reasoning 活动行。 */
function AgentReasoning({ part, message_streaming }: { part: SessionAgentReasoningPart; message_streaming: boolean }) {
  const translate_chat = use_translation("chat");
  const text = part.text.trim();
  if (!text) return null;
  return <ActivityRow
    {...summarize_activity(part, message_streaming, translate_chat)}
    body={<div className="reasoning-activity-content"><div className="reasoning-block">{text}</div></div>}
  />;
}

/**
 * Tool 生命周期、摘要、展开详情，以及属于本次调用的 Interaction。
 *
 * Interaction 是面向用户的对话内容，不折叠进 Tool 详情，始终直接可见。
 */
function AgentTool({ part, respond_interaction }: { part: SessionAgentToolPart; respond_interaction(input: RespondSessionInteractionInput): Promise<void> }) {
  const translate_chat = use_translation("chat");
  const presentation = resolve_agent_tool_presentation(part);
  return <>
    <ActivityRow
      {...row_from_presentation(presentation, translate_chat)}
      auto_open={should_auto_open_agent_tool(part)}
    />
    {(part.interactions ?? []).map((interaction) => <AgentInteraction key={interaction.interaction_id} part={interaction} respond={respond_interaction} />)}
  </>;
}

/**
 * Session Action（fork、压缩、命令等）在活动集合中的一行。
 *
 * 它走与 Tool 完全相同的行结构与语气机制，因此同一段连续活动不会因为夹了一条 Action 而断成两组。
 */
function AgentAction({ part }: { part: SessionAgentActionPart }) {
  const translate_chat = use_translation("chat");
  return <ActivityRow {...row_from_presentation(resolve_agent_action_presentation(part), translate_chat)} />;
}

/** 活动行摘要。 */
interface ActivityRowSummary {
  /** 行首图标。 */
  icon: ReactNode;
  /** 行样式语气。 */
  tone: AgentActivityTone;
  /** 本地化后的状态文案。 */
  state: string;
  /** 单行摘要。 */
  summary: string;
  /** 展开内容；为空时该行不可展开。 */
  body?: ReactNode;
}

/** 由展示映射生成活动行内容；Tool 与 Action 共用它，两者只有映射来源不同。 */
function row_from_presentation(presentation: AgentActivityPresentation, translate: (key: string) => string): ActivityRowSummary {
  return {
    icon: <ActivityIcon visual_kind={presentation.visual_kind} />,
    tone: presentation.tone,
    state: translate(presentation.state_key),
    summary: presentation.summary,
    body: presentation.detail || presentation.error
      ? <ActivityDetail detail={presentation.detail} error={presentation.error} input_streaming={presentation.input_streaming} />
      : undefined,
  };
}

/** 由一条活动 Part 生成活动行内容；Tool 与 Action 走展示映射，Reasoning 用思考文案。 */
function summarize_activity(part: AgentActivityPart, message_streaming: boolean, translate: (key: string) => string): ActivityRowSummary {
  if (part.type === "tool") return row_from_presentation(resolve_agent_tool_presentation(part), translate);
  if (part.type === "action") return row_from_presentation(resolve_agent_action_presentation(part), translate);
  const running = part.state === "streaming" || message_streaming;
  return {
    icon: <ActivityIcon visual_kind="reasoning" />,
    tone: running ? "running" : "complete",
    state: translate(running ? "activity.thinking" : "activity.thought"),
    summary: reasoning_preview(part.text),
  };
}

/**
 * 活动行的唯一视觉结构：图标、状态、摘要，加可选的计数徽标与展开内容。
 *
 * Reasoning、Tool 与活动组只有文案、语气和展开内容不同，因此共用同一行结构，
 * 不再各自维护一份 details / summary 标记。
 */
function ActivityRow({ icon, tone, state, summary, badge, body, auto_open, auto_open_key = "", summary_class_name }: {
  /** 行首图标。 */
  icon: ReactNode;
  /** 行样式语气。 */
  tone: AgentActivityTone;
  /** 本地化后的状态文案。 */
  state: string;
  /** 单行摘要。 */
  summary: string;
  /** 可选的计数徽标。 */
  badge?: string;
  /** 展开内容；为空时该行不可展开。 */
  body?: ReactNode;
  /** 为真时展开一次，用于流式输入与待响应交互。 */
  auto_open?: boolean;
  /** 变化时重新展开一次；同一自动展开原因内的更新不打断用户手动折叠。 */
  auto_open_key?: string;
  /** 摘要行的附加样式钩子，活动组用于强调分组摘要。 */
  summary_class_name?: string;
}) {
  const [open, set_open] = useState(Boolean(auto_open));
  useEffect(() => {
    if (auto_open) set_open(true);
  }, [auto_open, auto_open_key]);

  const summary_content = <span className="activity-tool-main">
    {icon}
    <span className="activity-tool-state">{state}</span>
    <span className="activity-tool-name">{summary}</span>
    {badge ? <span className="activity-tool-count">{badge}</span> : null}
    {body ? <TbChevronRight className="activity-tool-chevron" aria-hidden /> : null}
  </span>;
  const row_class = cn("activity-tool-row", AGENT_ACTIVITY_TONE_CLASS[tone]);
  const summary_class = cn("activity-tool-summary", summary_class_name);
  if (!body) return <div className={row_class}><div className={summary_class}>{summary_content}</div></div>;
  return <details open={open} onToggle={(event) => set_open(event.currentTarget.open)} className={row_class}>
    <summary className={summary_class}>{summary_content}</summary>
    {body}
  </details>;
}

/** 活动展开详情：正文或编辑对照，失败时补一行可读原因。 */
function ActivityDetail({ detail, error, input_streaming }: {
  /** 展开详情形态；为空时只渲染失败原因。 */ detail: AgentActivityDetail | null;
  /** 失败原因；为空表示没有失败信息。 */ error: string;
  /** 输入仍在流式到达，详情末尾显示输入光标。 */ input_streaming: boolean;
}) {
  return <div className="activity-tool-detail">
    {detail ? <ActivityDetailBody detail={detail} streaming={input_streaming} /> : null}
    {error ? <p role="alert" className="whitespace-pre-wrap break-words px-2.5 py-2 text-2xs leading-[1.45] text-destructive">{error}</p> : null}
  </div>;
}

/** 按详情形态渲染正文。 */
function ActivityDetailBody({ detail, streaming }: { detail: AgentActivityDetail; streaming: boolean }) {
  if (detail.type === "edit") return <EditDiff pairs={detail.pairs} streaming={streaming} />;
  return <pre className={detail.type === "console" ? "activity-tool-console" : undefined}>{detail.text}{streaming ? <InputCaret /> : null}</pre>;
}

/** 编辑前后对照；流式输入时在最后一行末尾显示光标。 */
function EditDiff({ pairs, streaming }: { pairs: readonly AgentActivityEditPair[]; streaming: boolean }) {
  return <div className="activity-tool-edit-diff">{pairs.map((pair, pair_index) => {
    const caret_on_pair = streaming && pair_index === pairs.length - 1;
    return <div key={pair_index} className="activity-tool-edit-pair">
      {pair.old_text ? split_lines(pair.old_text).map((line, line_index) => <pre key={`old:${line_index}`} className="activity-tool-diff-line is-removal"><code>{line || " "}</code></pre>) : null}
      {pair.new_text || caret_on_pair ? split_lines(pair.new_text).map((line, line_index, lines) => <pre key={`new:${line_index}`} className="activity-tool-diff-line is-addition"><code>{line || " "}{caret_on_pair && line_index === lines.length - 1 ? <InputCaret /> : null}</code></pre>) : null}
    </div>;
  })}</div>;
}

/** 流式输入到达位置的输入光标。 */
function InputCaret() {
  return <span className="activity-tool-input-caret" aria-hidden />;
}

/** 活动行图标；种类到图标的唯一映射点。 */
function ActivityIcon({ visual_kind }: { visual_kind: AgentActivityVisualKind }) {
  const Icon = AGENT_ACTIVITY_ICONS[visual_kind];
  return <Icon className="activity-tool-icon" aria-hidden />;
}

function split_lines(text: string): string[] { return text.split("\n"); }
function reasoning_preview(text: string): string { return text.replace(/\s+/g, " ").trim(); }
function assert_never(value: never): never { throw new Error(`不支持的 Agent Activity Part：${String((value as { type?: unknown }).type)}`); }
