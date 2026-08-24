/**
 * Assistant 消息内容与活动日志。
 *
 * 组件按 canonical part 顺序渲染文本、文件、来源、Reasoning、Tool 与 Interaction，
 * 并复用 Duobox 的连续活动折叠、紧凑状态行和内联交互卡片语义。
 */

import { useEffect, useState, type FormEvent, type ComponentType } from "react";
import type { RespondSessionInteractionInput, SessionAssistantInteractionPart, SessionAssistantMessagePart, SessionInteractionQuestion } from "@downcity/agent";
import {
  TbBulb,
  TbCheck,
  TbChevronLeft,
  TbChevronRight,
  TbFile,
  TbFilePencil,
  TbFilePlus,
  TbFileSearch,
  TbLoader2,
  TbMessageQuestion,
  TbPuzzle,
  TbSearch,
  TbSend,
  TbTerminal2,
  TbTextScan2,
  TbX,
} from "react-icons/tb";
import { ChatMarkdown } from "@/lib/chat/ChatMarkdown";
import { cn } from "@/lib/utils";
import {
  group_assistant_activities,
  group_assistant_content,
  read_tool_input_text,
  resolve_tool_presentation,
  should_auto_open_activity_group,
  should_force_open_activity_group,
  should_force_open_tool,
  type AssistantActivityPart,
  type AssistantToolVisualKind,
} from "./assistant_activity";

/** 按 canonical 顺序渲染 Assistant 的全部用户可见内容。 */
export function AssistantContent({ parts, show_reasoning, streaming, respond_interaction }: { /** Assistant 原始 parts。 */ parts: SessionAssistantMessagePart[]; /** 是否展示 Reasoning。 */ show_reasoning: boolean; /** 当前消息是否流式生成。 */ streaming: boolean; /** 响应审批或问题。 */ respond_interaction(input: RespondSessionInteractionInput): Promise<void> }) {
  const groups = group_assistant_content(parts);
  return <>{groups.map((group, index) => {
    if (group.type === "activity") return <ActivityBlock key={group.parts[0]?.part_id} parts={group.parts} show_reasoning={show_reasoning} streaming={streaming && index === groups.length - 1} respond_interaction={respond_interaction} />;
    const part = group.part;
    if (part.type === "text") return part.text ? <div key={part.part_id} className="text-[0.8125rem] leading-[1.54] text-foreground/90"><ChatMarkdown class_name="min-h-[1.54em]" text={part.text} mode={streaming && part.state === "streaming" ? "streaming" : "static"} /></div> : null;
    if (part.type === "file") return <a key={part.part_id} href={part.url} className="assistant-resource-row" target="_blank" rel="noreferrer"><TbFile aria-hidden /><span>{part.filename || "文件"}</span></a>;
    if (part.type === "source") return part.source_type === "url"
      ? <a key={part.part_id} href={part.url} className="assistant-resource-row" target="_blank" rel="noreferrer"><TbFileSearch aria-hidden /><span>{part.title || part.url}</span></a>
      : <div key={part.part_id} className="assistant-resource-row"><TbFile aria-hidden /><span>{part.title || part.filename || "文档来源"}</span></div>;
    // data 与 step-start 没有稳定的通用展示语义，由专用 feature 在未来接管。
    return null;
  })}</>;
}

/** 连续活动块，Interaction 与对应 Tool 在同一折叠组中渲染。 */
function ActivityBlock({ parts, show_reasoning, streaming, respond_interaction }: { /** 连续活动 parts。 */ parts: AssistantActivityPart[]; /** 是否展示 Reasoning。 */ show_reasoning: boolean; /** 消息是否流式生成。 */ streaming: boolean; /** 响应 Interaction。 */ respond_interaction(input: RespondSessionInteractionInput): Promise<void> }) {
  const groups = group_assistant_activities(parts, show_reasoning);
  if (groups.length === 0) return null;
  return <div className="agent-process-body">{groups.map((group, index) => {
    if (group.type === "group") return <ActivityGroup key={group.parts[0]?.part_id} parts={group.parts} message_streaming={streaming && index === groups.length - 1} respond_interaction={respond_interaction} />;
    const part = group.part;
    if (part.type === "reasoning") return <ReasoningRow key={part.part_id} part={part} message_streaming={streaming && index === groups.length - 1} />;
    if (part.type === "tool") return <ToolRow key={part.part_id} part={part} />;
    return <InteractionCard key={part.part_id} part={part} respond={respond_interaction} />;
  })}</div>;
}

/** 聚合连续活动，待处理 Interaction 自动展开。 */
function ActivityGroup({ parts, message_streaming, respond_interaction }: { /** 聚合的活动 parts。 */ parts: AssistantActivityPart[]; /** 消息是否仍在流式生成。 */ message_streaming: boolean; /** 响应组内 Interaction。 */ respond_interaction(input: RespondSessionInteractionInput): Promise<void> }) {
  const [open, set_open] = useState(() => should_auto_open_activity_group(parts));
  const tool_parts = parts.filter((part): part is Extract<AssistantActivityPart, { type: "tool" }> => part.type === "tool");
  const last_tool = tool_parts[tool_parts.length - 1];
  const last_reasoning = find_last_reasoning(parts);
  const pending_interaction = parts.find((part): part is SessionAssistantInteractionPart => part.type === "interaction" && part.status === "pending");
  const failed = tool_parts.some((part) => part.state === "failed");
  const force_open = should_force_open_activity_group(parts);
  const auto_open = should_auto_open_activity_group(parts);
  useEffect(() => set_open(auto_open), [auto_open, pending_interaction?.interaction_id]);
  const running = parts.some((part, index) => part.type === "tool"
    ? resolve_tool_presentation(part).running
    : part.type === "reasoning" && (part.state === "streaming" || (message_streaming && index === parts.length - 1)));
  const detail = pending_interaction ? interaction_title(pending_interaction) : last_tool ? resolve_tool_presentation(last_tool).detail : reasoning_preview(last_reasoning?.text ?? "");
  const visual_kind = last_tool ? resolve_tool_presentation(last_tool).visual_kind : undefined;
  return <details open={force_open || open} onToggle={(event) => handle_details_toggle(event.currentTarget, force_open, set_open)} className={cn("activity-tool-row", tool_parts.some(should_force_open_tool) && "has-change-preview", failed ? "is-failed" : pending_interaction ? "is-waiting" : running ? "is-running" : "is-complete")}>
    <summary className="activity-tool-summary activity-tool-group-summary"><span className="activity-tool-main"><ActivityIcon visual_kind={visual_kind} /><span className="activity-tool-state">{failed ? "执行失败" : pending_interaction ? "等待响应" : running ? "正在执行" : "已完成"}</span><span className="activity-tool-name">{detail}{parts.length > 1 ? ` (+${parts.length - 1})` : ""}</span><TbChevronRight className="activity-tool-chevron" aria-hidden /></span></summary>
    <div className="activity-tool-group-body">{parts.map((part, index) => <div key={part.part_id} className="activity-tool-log">{part.type === "tool" ? <ToolRow part={part} /> : part.type === "reasoning" ? <ReasoningRow part={part} message_streaming={message_streaming && index === parts.length - 1} /> : <InteractionCard part={part} respond={respond_interaction} />}</div>)}</div>
  </details>;
}

/** 可展开的 Reasoning 活动行。 */
function ReasoningRow({ part, message_streaming }: { /** Reasoning part。 */ part: Extract<AssistantActivityPart, { type: "reasoning" }>; /** 当前是否仍在生成。 */ message_streaming: boolean }) {
  const running = part.state === "streaming" || message_streaming;
  const text = part.text.trim();
  if (!text) return null;
  return <details className={cn("activity-tool-row reasoning-activity-row", running ? "is-running" : "is-complete")}>
    <summary className="activity-tool-summary"><span className="activity-tool-main"><TbBulb className="activity-tool-icon" aria-hidden /><span className="activity-tool-state">{running ? "正在思考" : "已思考"}</span><span className="activity-tool-name">{reasoning_preview(text)}</span><TbChevronRight className="activity-tool-chevron" aria-hidden /></span></summary>
    <div className="reasoning-activity-content"><div className="reasoning-block">{text}</div></div>
  </details>;
}

/** Tool 生命周期、摘要以及展开详情。 */
function ToolRow({ part }: { /** Tool part。 */ part: Extract<AssistantActivityPart, { type: "tool" }> }) {
  const [open, set_open] = useState(false);
  const presentation = resolve_tool_presentation(part);
  const force_open = should_force_open_tool(part);
  return <details open={force_open || open} onToggle={(event) => handle_details_toggle(event.currentTarget, force_open, set_open)} title={presentation.detail} className={cn("activity-tool-row", force_open && "has-change-preview", presentation.running ? "is-running" : presentation.failed ? "is-failed" : "is-complete")}>
    <summary className="activity-tool-summary"><span className="activity-tool-main"><ActivityIcon visual_kind={presentation.visual_kind} /><span className="activity-tool-state">{presentation.state_label}</span><span className="activity-tool-name">{presentation.detail}</span><TbChevronRight className="activity-tool-chevron" aria-hidden /></span></summary>
    <ToolDetails part={part} visual_kind={presentation.visual_kind} />
  </details>;
}

/** 根据 Tool 语义选择详情面板。 */
function ToolDetails({ part, visual_kind }: { /** Tool part。 */ part: Extract<AssistantActivityPart, { type: "tool" }>; /** Tool 视觉类型。 */ visual_kind: AssistantToolVisualKind }) {
  const input = part.input ?? part.raw_input ?? part.input_text;
  if (visual_kind === "write" || visual_kind === "edit") return <FileChangePreview part={part} visual_kind={visual_kind} />;
  if (visual_kind === "shell") {
    const command = read_tool_input_text(input, ["cmd", "command", "input"]);
    return <div className="activity-tool-terminal"><pre className="activity-tool-terminal-output"><span className="activity-tool-command-prompt">$ {command || part.tool_name}</span>{part.output !== undefined ? `\n${format_value(part.output)}` : ""}{part.error ? `\n${part.error}` : ""}</pre></div>;
  }
  return <div className="activity-tool-terminal"><pre className="activity-tool-terminal-output">{input !== undefined ? `Input\n${format_value(input)}` : ""}{part.output !== undefined ? `${input !== undefined ? "\n\n" : ""}Output\n${format_value(part.output)}` : ""}{part.error ? `${input !== undefined || part.output !== undefined ? "\n\n" : ""}Error\n${part.error}` : ""}</pre></div>;
}

/** 写文件与编辑文件的紧凑代码变化预览。 */
function FileChangePreview({ part, visual_kind }: { /** Tool part。 */ part: Extract<AssistantActivityPart, { type: "tool" }>; /** 写入或编辑类型。 */ visual_kind: "write" | "edit" }) {
  const input = part.input && typeof part.input === "object" && !Array.isArray(part.input) ? part.input as Record<string, unknown> : undefined;
  const content = typeof input?.content === "string" ? input.content : part.input_text || "";
  const edits = Array.isArray(input?.edits) ? input.edits : [];
  return <div className="activity-tool-terminal has-change-preview"><div className={cn("activity-tool-change-preview", part.state === "input-streaming" && "is-streaming")}>
    {visual_kind === "write" ? <pre className="activity-tool-write-content">{content}{part.state === "input-streaming" ? <span className="activity-tool-input-caret" aria-hidden /> : null}</pre> : <div className="activity-tool-edit-content">{edits.length ? edits.map((edit, index) => {
      const record = edit && typeof edit === "object" ? edit as Record<string, unknown> : {};
      const old_text = typeof record.old_text === "string" ? record.old_text : "";
      const new_text = typeof record.new_text === "string" ? record.new_text : "";
      return <div key={index} className="activity-tool-edit-pair">{old_text ? <pre className="activity-tool-diff-line is-removal"><span className="activity-tool-diff-marker">-</span><code>{old_text}</code></pre> : null}<pre className="activity-tool-diff-line is-addition"><span className="activity-tool-diff-marker">+</span><code>{new_text}{part.state === "input-streaming" && index === edits.length - 1 ? <span className="activity-tool-input-caret" aria-hidden /> : null}</code></pre></div>;
    }) : <pre className="activity-tool-write-content">{format_value(part.input ?? part.input_text)}</pre>}</div>}
  </div>{part.output !== undefined || part.error ? <pre className="activity-tool-terminal-output">{part.output !== undefined ? format_value(part.output) : part.error}</pre> : null}</div>;
}

/** Interaction 统一使用 Duobox 风格的独立卡片。 */
function InteractionCard({ part, respond }: { /** Interaction part。 */ part: SessionAssistantInteractionPart; /** 提交响应。 */ respond(input: RespondSessionInteractionInput): Promise<void> }) {
  if (part.request.type === "approval") return <ApprovalCard part={part} respond={respond} />;
  if (part.request.type === "question") return <QuestionCard part={part} respond={respond} />;
  return <GenericInteractionCard part={part} />;
}

/** 高风险操作审批卡片。 */
function ApprovalCard({ part, respond }: { /** Approval interaction。 */ part: SessionAssistantInteractionPart; /** 提交审批。 */ respond(input: RespondSessionInteractionInput): Promise<void> }) {
  const [submitting, set_submitting] = useState<"approve" | "deny">();
  const pending = part.status === "pending";
  const request = part.request;
  const payload = interaction_payload(request);
  const submit = async (decision: "approved" | "denied") => {
    if (!pending || submitting) return;
    set_submitting(decision === "approved" ? "approve" : "deny");
    try { await respond({ interaction_id: part.interaction_id, response: { type: request.type, outcome: decision === "approved" ? "resolved" : "denied", payload: { decision } } }); } finally { set_submitting(undefined); }
  };
  const operation = typeof payload.operation === "string" ? payload.operation : undefined;
  const detail = operation === "tool" ? format_value(payload.validated_input) : string_value(payload.command);
  const description = operation === "tool" ? string_value(payload.model_explanation) || string_value(payload.tool_description) : request.description || string_value(payload.reason);
  return <div className="interaction-card approval-interaction" role="group" aria-label="操作确认">
    <header className="interaction-card-header"><span className="interaction-card-title">操作确认</span><span className="interaction-card-meta">{interaction_status_label(part)}</span></header>
    <div className="interaction-card-body"><div className="approval-card-detail">{detail}</div>{description ? <p className="approval-card-message">{description}</p> : null}</div>
    <footer className="interaction-card-actions"><div className="approval-actions">{pending ? <><button type="button" className="approval-action reject" disabled={Boolean(submitting)} onClick={() => void submit("denied")}>{submitting === "deny" ? <TbLoader2 className="animate-spin" /> : <TbX />}<span>拒绝</span></button><button type="button" className="approval-action approve" disabled={Boolean(submitting)} onClick={() => void submit("approved")}>{submitting === "approve" ? <TbLoader2 className="animate-spin" /> : <TbCheck />}<span>允许</span></button></> : <span className="interaction-terminal-label">{approval_result_label(part)}</span>}</div></footer>
  </div>;
}

/** 多问题逐题导航卡片。 */
function QuestionCard({ part, respond }: { /** Question interaction。 */ part: SessionAssistantInteractionPart; /** 提交回答。 */ respond(input: RespondSessionInteractionInput): Promise<void> }) {
  const [answers, set_answers] = useState<Record<string, string | string[]>>(() => read_question_answers(part));
  const [current_index, set_current_index] = useState(0);
  const [submitting, set_submitting] = useState(false);
  const request = part.request;
  const questions = interaction_questions(request);
  const question = questions[current_index];
  const pending = part.status === "pending";
  if (!question) return null;
  const current_complete = is_answer_complete(answers[question.question_id]);
  const all_complete = questions.every((item) => is_answer_complete(answers[item.question_id]));
  const last = current_index === questions.length - 1;
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!pending || submitting || !current_complete) return;
    if (!last) { set_current_index((value) => value + 1); return; }
    if (!all_complete) return;
    set_submitting(true);
    try {
      await respond({ interaction_id: part.interaction_id, response: { type: request.type, outcome: "resolved", payload: { answers: questions.map((item) => ({ question_id: item.question_id, value: answers[item.question_id] })) } } });
    } finally { set_submitting(false); }
  };
  return <form className="interaction-card question-interaction" aria-label={request.title || request.type} onSubmit={(event) => void submit(event)}>
    <header className="interaction-card-header"><span className="interaction-card-title">{request.title || "需要输入"}</span><span className="interaction-card-meta">{pending ? `${current_index + 1} / ${questions.length}` : interaction_status_label(part)}</span></header>
    <div className="interaction-card-body question-stage"><div className="question-prompt">{question.prompt}</div><QuestionField question={question} value={answers[question.question_id]} disabled={!pending || submitting} set_value={(value) => set_answers((current) => ({ ...current, [question.question_id]: value }))} /></div>
    <footer className="interaction-card-actions"><span className="question-footer-hint">{question.response_type === "single_select" ? "选择一项" : question.response_type === "multi_select" ? "可选择多项" : ""}</span>{pending ? <div className="question-navigation">{current_index > 0 ? <button type="button" className="question-back" disabled={submitting} onClick={() => set_current_index((value) => value - 1)}><TbChevronLeft />上一题</button> : null}<button type="submit" className="question-submit" disabled={!current_complete || submitting}>{submitting ? <TbLoader2 className="animate-spin" /> : last ? <TbSend /> : <TbChevronRight />}{submitting ? "提交中" : last ? "提交回答" : "下一题"}</button></div> : <span className="interaction-terminal-label">{question_result_label(part)}</span>}</footer>
  </form>;
}

/** 单个问题的文本、单选或多选输入。 */
function QuestionField({ question, value, disabled, set_value }: { /** 当前问题。 */ question: SessionInteractionQuestion; /** 当前回答。 */ value?: string | string[]; /** 是否禁用。 */ disabled: boolean; /** 更新回答。 */ set_value(value: string | string[]): void }) {
  if (question.response_type === "text") return <textarea className="question-text-input" disabled={disabled} value={typeof value === "string" ? value : ""} onChange={(event) => set_value(event.target.value)} />;
  return <div className="question-options">{question.options?.map((option) => {
    const checked = Array.isArray(value) ? value.includes(option.value) : value === option.value;
    return <label key={option.value} className={cn("question-option", checked && "is-selected")}><input disabled={disabled} type={question.response_type === "multi_select" ? "checkbox" : "radio"} name={question.question_id} checked={checked} onChange={() => {
      if (question.response_type === "single_select") set_value(option.value);
      else { const current = Array.isArray(value) ? value : []; set_value(checked ? current.filter((item) => item !== option.value) : [...current, option.value]); }
    }} /><span><span className="question-option-label">{option.label}</span>{option.description ? <span className="question-option-description">{option.description}</span> : null}</span></label>;
  })}</div>;
}

/** 活动类型图标。 */
function ActivityIcon({ visual_kind }: { /** Tool 视觉类型；省略表示 Reasoning。 */ visual_kind?: AssistantToolVisualKind }) {
  const icons: Record<AssistantToolVisualKind, ComponentType<{ className?: string; "aria-hidden"?: boolean }>> = { read: TbTextScan2, write: TbFilePlus, edit: TbFilePencil, grep: TbSearch, find: TbFileSearch, shell: TbTerminal2, ask: TbMessageQuestion, plugin: TbPuzzle, generic: TbPuzzle };
  const Icon = visual_kind ? icons[visual_kind] : TbBulb;
  return <Icon className="activity-tool-icon" aria-hidden />;
}

function reasoning_preview(text: string): string { return text.replace(/\s+/g, " ").trim(); }
function handle_details_toggle(details: HTMLDetailsElement, force_open: boolean, set_open: (open: boolean) => void): void {
  if (force_open) {
    if (!details.open) details.open = true;
    return;
  }
  set_open(details.open);
}
function find_last_reasoning(parts: AssistantActivityPart[]): Extract<AssistantActivityPart, { type: "reasoning" }> | undefined {
  for (let index = parts.length - 1; index >= 0; index -= 1) {
    const part = parts[index];
    if (part?.type === "reasoning") return part;
  }
  return undefined;
}
function interaction_title(part: SessionAssistantInteractionPart): string { return part.request.title || (part.request.type === "approval" ? "操作确认" : part.request.type === "question" ? "需要输入" : part.request.type); }
function is_answer_complete(value: string | string[] | undefined): value is string | string[] { return Array.isArray(value) ? value.length > 0 : typeof value === "string" && Boolean(value.trim()); }
function read_question_answers(part: SessionAssistantInteractionPart): Record<string, string | string[]> {
  const payload = part.response?.payload;
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return {};
  const answers = (payload as { answers?: unknown }).answers;
  if (!Array.isArray(answers)) return {};
  return Object.fromEntries(answers.flatMap((answer) => {
    if (!answer || typeof answer !== "object" || Array.isArray(answer)) return [];
    const item = answer as { question_id?: unknown; value?: unknown };
    return typeof item.question_id === "string" && (typeof item.value === "string" || Array.isArray(item.value))
      ? [[item.question_id, item.value as string | string[]]]
      : [];
  }));
}
function format_value(value: unknown): string { if (typeof value === "string") return value; try { return JSON.stringify(value, null, 2) ?? ""; } catch { return String(value); } }
function interaction_status_label(part: SessionAssistantInteractionPart): string { return part.status === "pending" ? "等待响应" : part.status === "resolved" ? "已响应" : part.status === "expired" ? "已过期" : part.status === "cancelled" ? "已取消" : "已失败"; }
function approval_result_label(part: SessionAssistantInteractionPart): string {
  const payload = part.response?.payload;
  const decision = payload && typeof payload === "object" && !Array.isArray(payload) ? (payload as { decision?: unknown }).decision : undefined;
  return decision === "approved" ? "已允许" : part.status === "expired" ? "已过期" : part.status === "cancelled" ? "已取消" : part.status === "failed" ? "已失败" : "已拒绝";
}
function question_result_label(part: SessionAssistantInteractionPart): string { return part.status === "expired" ? "已过期" : part.status === "cancelled" ? "已取消" : "已回答"; }

function interaction_payload(request: SessionAssistantInteractionPart["request"]): Record<string, unknown> {
  return request.payload && typeof request.payload === "object" && !Array.isArray(request.payload)
    ? request.payload as Record<string, unknown>
    : {};
}

function interaction_questions(request: SessionAssistantInteractionPart["request"]): SessionInteractionQuestion[] {
  const questions = interaction_payload(request).questions;
  return Array.isArray(questions) ? questions as SessionInteractionQuestion[] : [];
}

function string_value(value: unknown): string | undefined { return typeof value === "string" && value ? value : undefined; }

function GenericInteractionCard({ part }: { /** 未注册 renderer 的动态 Interaction。 */ part: SessionAssistantInteractionPart }) {
  return <div className="interaction-card" role="status"><header className="interaction-card-header"><span className="interaction-card-title">{interaction_title(part)}</span><span className="interaction-card-meta">{interaction_status_label(part)}</span></header><div className="interaction-card-body">此交互类型需要宿主应用提供自定义呈现：{part.request.type}</div></div>;
}
