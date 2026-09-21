/** Agent Message 中连续 Reasoning、Tool 与 Action 的活动展示。 */

import { useEffect, useMemo, useState, type ComponentType, type ReactNode } from "react";
import type { RespondSessionInteractionInput, SessionAgentActionPart, SessionAgentReasoningPart, SessionAgentToolPart } from "@downcity/agent";
import { TbArrowsMinimize, TbBulb, TbChevronRight, TbCommand, TbFileSearch, TbGitFork, TbMessageQuestion, TbPencil, TbPencilPlus, TbPuzzle, TbSearch, TbTextScan2 } from "react-icons/tb";
import { AgentInteraction } from "@/features/chat/components/messages/AgentInteraction";
import { use_chat_power_lookup } from "@/features/chat/components/messages/ChatPowerLookup";
import { use_open_interaction_tab } from "@/features/chat/panel/InteractionPanel";
import { PowerIcon } from "@/features/power/lib/PowerIcon";
import { chat_power_names, resolve_agent_action_presentation, resolve_agent_tool_presentation, resolve_power_identity_text, select_activity_summary_part, should_auto_open_agent_activity, should_auto_open_agent_tool } from "@/features/chat/lib/message/agent_activity_presentation";
import type { AgentActivityDetail, AgentActivityEditPair, AgentActivityPart, AgentActivityPresentation, AgentActivityTone, AgentActivityVisualKind, ChatPowerLookup } from "@/features/chat/types/AgentMessage";
import { cn } from "@/lib/utils";
import { use_translation } from "@/locales/i18n";

/**
 * 活动行图标；Reasoning、Tool 与 Action 共用一张表，新增种类由类型系统强制补全。
 *
 * `power` 不在这张表里：power 的图标由 `PowerIcon` 按 power 名解析，与 Sidebar、
 * 命令面板共用同一份事实源。同一个 power 在这三处必须长得一样。
 */
const AGENT_ACTIVITY_ICONS: Record<Exclude<AgentActivityVisualKind, "power">, ComponentType<{ className?: string; "aria-hidden"?: boolean }>> = {
  reasoning: TbBulb,
  read: TbTextScan2,
  write: TbPencilPlus,
  edit: TbPencil,
  grep: TbSearch,
  find: TbFileSearch,
  ask: TbMessageQuestion,
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
 *
 * Power 目录由 context 注入：它是全局事实，消息渲染树有七层，逐层传 prop 会让
 * 每一层都多一个与自身职责无关的参数。未注入时身份降级为注册名，不会报错。
 */
export function AgentActivity({ parts, show_reasoning, streaming, respond_interaction }: { parts: readonly AgentActivityPart[]; show_reasoning: boolean; streaming: boolean; respond_interaction(input: RespondSessionInteractionInput): Promise<void> }) {
  const power_lookup = use_chat_power_lookup();
  const power_names = useMemo(() => chat_power_names(power_lookup), [power_lookup]);
  const visible_parts = parts.filter((part) => part.type !== "reasoning" || (show_reasoning && Boolean(part.text.trim())));
  if (visible_parts.length === 0) return null;
  return <div className="agent-process-body">
    {visible_parts.length === 1
      ? <AgentActivityItem part={visible_parts[0]} message_streaming={streaming} respond_interaction={respond_interaction} lookup={power_lookup} power_names={power_names} />
      : <AgentActivityGroup parts={visible_parts} message_streaming={streaming} respond_interaction={respond_interaction} lookup={power_lookup} power_names={power_names} />}
  </div>;
}

/** 多个连续活动共用的折叠摘要与展开状态。摘要始终取最后一个非 Reasoning 项。 */
function AgentActivityGroup({ parts, message_streaming, respond_interaction, lookup, power_names }: { parts: readonly AgentActivityPart[]; message_streaming: boolean; respond_interaction(input: RespondSessionInteractionInput): Promise<void>; lookup: ChatPowerLookup; power_names: ReadonlySet<string> }) {
  const translate_chat = use_translation("chat");
  const summary_part = select_activity_summary_part(parts) ?? parts[parts.length - 1];
  // Interaction 属于 Tool Part；待响应时自动展开一次，方便用户直接回答。
  const pending_interaction_id = parts
    .flatMap((part) => part.type === "tool" ? (part.interactions ?? []) : [])
    .find((interaction) => interaction.status === "pending")?.interaction_id ?? "";
  return <ActivityRow
    {...summarize_activity(summary_part, message_streaming, translate_chat, lookup, power_names)}
    badge={`+${parts.length - 1}`}
    auto_open={should_auto_open_agent_activity(parts, power_names)}
    auto_open_key={pending_interaction_id}
    summary_class_name="activity-tool-group-summary"
    body={<div className="activity-tool-group-body">{parts.map((part, index) => <div key={part.part_id} className="activity-tool-log"><AgentActivityItem part={part} message_streaming={message_streaming && index === parts.length - 1} respond_interaction={respond_interaction} lookup={lookup} power_names={power_names} /></div>)}</div>}
  />;
}

/** 对单个 canonical 活动 Part 做穷尽分发。 */
function AgentActivityItem({ part, message_streaming, respond_interaction, lookup, power_names }: { part: AgentActivityPart; message_streaming: boolean; respond_interaction(input: RespondSessionInteractionInput): Promise<void>; lookup: ChatPowerLookup; power_names: ReadonlySet<string> }) {
  switch (part.type) {
    case "reasoning": return <AgentReasoning part={part} message_streaming={message_streaming} />;
    case "tool": return <AgentTool part={part} respond_interaction={respond_interaction} lookup={lookup} power_names={power_names} />;
    case "action": return <AgentAction part={part} />;
    default: return assert_never(part);
  }
}

/** 可展开的 Reasoning 活动行。 */
function AgentReasoning({ part, message_streaming }: { part: SessionAgentReasoningPart; message_streaming: boolean }) {
  const translate_chat = use_translation("chat");
  const text = part.text.trim();
  if (!text) return null;
  const running = part.state === "streaming" || message_streaming;
  return <ActivityRow
    icon={<ActivityIcon visual_kind="reasoning" />}
    tone={running ? "running" : "complete"}
    mutation={false}
    state={translate_chat(running ? "activity.thinking" : "activity.thought")}
    identity={reasoning_preview(text)}
    identity_action=""
    summary=""
    body={<div className="reasoning-activity-content"><div className="reasoning-block">{text}</div></div>}
  />;
}

/**
 * Tool 生命周期、身份、摘要、展开详情，以及属于本次调用的 Interaction。
 *
 * ## Interaction 在折叠内部
 *
 * 它是**这一次调用**要向用户提的问题，因此属于这一行的展开内容：
 * 行折起来时看不到，展开才出现。此前它挂在折叠之外，导致：
 *
 * - 行折起来时卡片还在外面，看不出它属于哪一次调用；
 * - 一张审批卡（标题 + 正文 + 输入框 + 两个按钮）内联在时间线里会把上下文推走。
 *
 * 待响应的 Interaction 仍然会自动展开这一行（用户不必自己去点开），
 * 但不再“永远露在外面”。
 */
function AgentTool({ part, respond_interaction, lookup, power_names }: { part: SessionAgentToolPart; respond_interaction(input: RespondSessionInteractionInput): Promise<void>; lookup: ChatPowerLookup; power_names: ReadonlySet<string> }) {
  const translate_chat = use_translation("chat");
  const open_in_panel = use_open_interaction_tab();
  const presentation = resolve_agent_tool_presentation(part, power_names);
  const interactions = part.interactions ?? [];
  const summary = row_from_presentation(presentation, translate_chat, lookup);
  // 待响应时自动展开一次；这是“不必手动点开”，不是“永远露在外面”。
  const pending = interactions.some((interaction) => interaction.status === "pending");
  return <ActivityRow
    {...summary}
    auto_open={should_auto_open_agent_tool(part, power_names) || pending}
    extra_body={interactions.length > 0 ? <div className="activity-tool-interactions">
      {interactions.map((interaction) => <AgentInteraction
        key={interaction.interaction_id}
        part={interaction}
        respond={respond_interaction}
        open_in_panel={() => open_in_panel(interaction, respond_interaction)}
      />)}
    </div> : undefined}
  />;
}

/**
 * Session Action（fork、压缩、命令等）在活动集合中的一行。
 *
 * 它走与 Tool 完全相同的行结构与语气机制，因此同一段连续活动不会因为夹了一条 Action 而断成两组。
 */
function AgentAction({ part }: { part: SessionAgentActionPart }) {
  const translate_chat = use_translation("chat");
  return <ActivityRow {...row_from_presentation(resolve_agent_action_presentation(part), translate_chat, new Map())} />;
}

/** 活动行内容。 */
interface ActivityRowSummary {
  /** 行首图标。 */
  icon: ReactNode;
  /** 行样式语气。 */
  tone: AgentActivityTone;
  /** 是否对文件产生修改；为真时行内文字与图标用强调色。 */
  mutation: boolean;
  /** 本地化后的状态文案。 */
  state: string;
  /** 身份主文案；永不截断。 */
  identity: string;
  /** 身份次要文案（power 的 action）；为空时整段不渲染。 */
  identity_action: string;
  /** 弱化摘要（目标对象或参数预览）；为空时整段不渲染。 */
  summary: string;
  /** 展开内容；为空时该行不可展开。 */
  body?: ReactNode;
}

/**
 * 由展示映射生成活动行内容；Tool 与 Action 共用它，两者只有映射来源不同。
 *
 * 关键点（中文）：**只有 Power 有独立身份槽**。内置工具的状态词本身就是动词（「已读取」），
 * 摘要就是它的目标；Action 的主文案就是标题；未知工具原样显示注册名。
 * 三者都直接占身份位、摘要位留空——否则会渲染成「已读取 读取文件 src/a.ts」
 * 或「custom_tool custom_tool」这种把同一件事说两遍的行。
 */
function row_from_presentation(presentation: AgentActivityPresentation, translate: (key: string, options?: Record<string, string>) => string, lookup: ChatPowerLookup): ActivityRowSummary {
  const power = presentation.tool_identity?.kind === "power" ? presentation.tool_identity : undefined;
  const identity = power
    ? resolve_power_identity_text(power.power_name, power.action_name, lookup, translate)
    : { label: presentation.summary, action: "" };
  return {
    icon: <ActivityIcon visual_kind={presentation.visual_kind} power_name={power?.power_name} />,
    tone: presentation.tone,
    mutation: presentation.mutation,
    state: translate(presentation.state_key),
    identity: identity.label,
    identity_action: identity.action,
    summary: power ? presentation.summary : "",
    body: presentation.detail || presentation.error
      ? <ActivityDetail detail={presentation.detail} error={presentation.error} input_streaming={presentation.input_streaming} />
      : undefined,
  };
}

/** 由一条活动 Part 生成活动行内容；Tool 与 Action 走展示映射，Reasoning 用思考文案。 */
function summarize_activity(part: AgentActivityPart, message_streaming: boolean, translate: (key: string, options?: Record<string, string>) => string, lookup: ChatPowerLookup, power_names: ReadonlySet<string>): ActivityRowSummary {
  if (part.type === "tool") return row_from_presentation(resolve_agent_tool_presentation(part, power_names), translate, lookup);
  if (part.type === "action") return row_from_presentation(resolve_agent_action_presentation(part), translate, lookup);
  const running = part.state === "streaming" || message_streaming;
  return {
    icon: <ActivityIcon visual_kind="reasoning" />,
    tone: running ? "running" : "complete",
    mutation: false,
    state: translate(running ? "activity.thinking" : "activity.thought"),
    identity: reasoning_preview(part.text),
    identity_action: "",
    summary: "",
  };
}

/**
 * 活动行的唯一视觉结构：图标、状态、身份、摘要，加可选的计数徽标与展开内容。
 *
 * Reasoning、Tool 与活动组只有文案、语气和展开内容不同，因此共用同一行结构，
 * 不再各自维护一份 details / summary 标记。
 *
 * 身份与参数之间的 `·` 是真实文本节点，不是 CSS 造的视觉间距：读屏要能听出
 * 「Shell · 执行命令 · pnpm test」的停顿，靠 `gap` 会连读成一个词。
 */
function ActivityRow({ icon, tone, mutation, state, identity, identity_action, summary, badge, body, extra_body, auto_open, auto_open_key = "", summary_class_name }: {
  /** 行首图标。 */ icon: ReactNode;
  /** 行样式语气。 */ tone: AgentActivityTone;
  /** 是否对文件产生修改。 */ mutation: boolean;
  /** 本地化后的状态文案。 */ state: string;
  /** 身份主文案；永不截断。 */ identity: string;
  /** 身份次要文案（power 的 action）。 */ identity_action: string;
  /** 弱化摘要。 */ summary: string;
  /** 可选的计数徽标。 */ badge?: string;
  /** 展开内容；为空时该行不可展开。 */ body?: ReactNode;
  /**
   * 追加在展开内容之后的交互区域（待回答的审批 / 提问）。
   *
   * 与 `body` 分开是因为两者语义不同：`body` 是“这次调用做了什么”（代码、控制台、diff），
   * `extra_body` 是“现在需要你做什么”。两者可以同时存在，也可以只有后者——
   * 例如 `ask_question` 没有可展示的输出，但有待回答的问题。
   */ extra_body?: ReactNode;
  /** 为真时展开一次，用于流式输入与待响应交互。 */ auto_open?: boolean;
  /** 变化时重新展开一次；同一自动展开原因内的更新不打断用户手动折叠。 */ auto_open_key?: string;
  /** 摘要行的附加样式钩子，活动组用于强调分组摘要。 */ summary_class_name?: string;
}) {
  const [open, set_open] = useState(Boolean(auto_open));
  useEffect(() => {
    if (auto_open) set_open(true);
  }, [auto_open, auto_open_key]);

  const has_expandable = Boolean(body) || Boolean(extra_body);
  const summary_content = <span className="activity-tool-main">
    {icon}
    <span className="activity-tool-state">{state}</span>
    <span className="activity-tool-identity">{identity}</span>
    {identity_action ? <>
      <span className="activity-tool-identity-separator" aria-hidden>·</span>
      <span className="activity-tool-identity">{identity_action}</span>
    </> : null}
    {summary ? <span className="activity-tool-target" title={summary}>{summary}</span> : null}
    {badge ? <span className="activity-tool-count">{badge}</span> : null}
    {has_expandable ? <TbChevronRight className="activity-tool-chevron" aria-hidden /> : null}
  </span>;
  const row_class = cn("activity-tool-row", AGENT_ACTIVITY_TONE_CLASS[tone], mutation && "is-mutation");
  const summary_class = cn("activity-tool-summary", summary_class_name);
  if (!has_expandable) return <div className={row_class}><div className={summary_class}>{summary_content}</div></div>;
  return <details open={open} onToggle={(event) => set_open(event.currentTarget.open)} className={row_class}>
    <summary className={summary_class}>{summary_content}</summary>
    {body}
    {extra_body}
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

/**
 * 活动行图标；种类到图标的唯一映射点。
 *
 * `visual_kind` 是**必填**：它曾经是可选的，而调用方漏传时不会报错，
 * 只会静默回退到 generic——所有内置工具都长成了同一个图标。
 * 现在漏传是编译错误。
 *
 * Power 走 `PowerIcon`：它在 Chat 活动行、Sidebar 与命令面板三处是同一份图标事实源，
 * 未知 power 也有通用回退，因此这里不再维护第二张 power 图标表。
 */
function ActivityIcon({ visual_kind, power_name = "" }: { visual_kind: AgentActivityVisualKind; power_name?: string }) {
  if (visual_kind === "power") {
    // power 身份必然同时给出 power 名；缺失时回退到通用图标，而不是渲染成空。
    return power_name
      ? <PowerIcon power_id={power_name} class_name="activity-tool-icon" />
      : <TbPuzzle className="activity-tool-icon" aria-hidden />;
  }
  const Icon = AGENT_ACTIVITY_ICONS[visual_kind];
  return <Icon className="activity-tool-icon" aria-hidden />;
}

function split_lines(text: string): string[] { return text.split("\n"); }
function reasoning_preview(text: string): string { return text.replace(/\s+/g, " ").trim(); }
function assert_never(value: never): never { throw new Error(`不支持的 Agent Activity Part：${String((value as { type?: unknown }).type)}`); }
