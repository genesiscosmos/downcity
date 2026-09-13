/** Agent Message 中审批与问题交互的独立状态边界。 */

import { useEffect, useState, type FormEvent } from "react";
import type { RespondSessionInteractionInput, SessionAgentInteraction, SessionInteractionQuestion } from "@downcity/agent";
import { TbCheck, TbChevronLeft, TbChevronRight, TbLoader2, TbSend, TbX } from "react-icons/tb";
import { cn } from "@/lib/utils";
import { translate } from "@/locales/i18n";

/** 根据 canonical Interaction 类型选择对应交互界面。 */
export function AgentInteraction({ part, respond }: { /** canonical Interaction Part。 */ part: SessionAgentInteraction; /** 提交结构化响应。 */ respond(input: RespondSessionInteractionInput): Promise<void> }) {
  if (part.request.type === "approval") return <ApprovalCard key={part.interaction_id} part={part} respond={respond} />;
  if (part.request.type === "question") return <QuestionCard key={part.interaction_id} part={part} respond={respond} />;
  return <GenericInteractionCard part={part} />;
}

/** 返回 Interaction 在 Activity 摘要中的稳定标题。 */
export function resolve_agent_interaction_title(part: SessionAgentInteraction): string {
  return part.request.title || (part.request.type === "approval"
    ? translate("chat:activity.confirmation")
    : part.request.type === "question"
      ? translate("chat:activity.input_required")
      : part.request.type);
}

/** 高风险操作审批卡片。 */
function ApprovalCard({ part, respond }: { /** Approval Interaction。 */ part: SessionAgentInteraction; /** 提交审批。 */ respond(input: RespondSessionInteractionInput): Promise<void> }) {
  const [submitting, set_submitting] = useState<"approve" | "deny">();
  const [note, set_note] = useState(() => read_interaction_note(part));
  const [submit_error, set_submit_error] = useState("");
  const pending = part.status === "pending";
  const request = part.request;
  useEffect(() => {
    if (pending) return;
    set_submitting(undefined);
    set_submit_error("");
  }, [pending]);
  const payload = interaction_payload(request);
  const submit = async (decision: "approved" | "denied") => {
    if (!pending || submitting) return;
    set_submitting(decision === "approved" ? "approve" : "deny");
    set_submit_error("");
    try {
      await respond({ interaction_id: part.interaction_id, response: { type: request.type, outcome: decision === "approved" ? "resolved" : "denied", payload: { decision, ...(note.trim() ? { reason: note.trim() } : {}) } } });
    } catch (reason) {
      set_submit_error(reason instanceof Error ? reason.message : String(reason));
    } finally {
      set_submitting(undefined);
    }
  };
  const operation = typeof payload.operation === "string" ? payload.operation : undefined;
  const detail = operation === "tool" ? format_value(payload.validated_input) : string_value(payload.command);
  const description = operation === "tool" ? string_value(payload.model_explanation) || string_value(payload.tool_description) : request.description || string_value(payload.reason);
  return <section className="interaction-card approval-interaction" aria-labelledby={`${part.interaction_id}-title`} aria-busy={Boolean(submitting)}>
    <header className="interaction-card-header"><span id={`${part.interaction_id}-title`} className="interaction-card-title">{translate("chat:activity.confirmation")}</span><span className="interaction-card-meta">{interaction_status_label(part)}</span></header>
    <div className="interaction-card-body"><div className="approval-card-detail">{detail}</div>{description ? <p className="approval-card-message">{description}</p> : null}<InteractionNote value={note} disabled={!pending || Boolean(submitting)} set_value={set_note} />{submit_error ? <p role="alert" className="mt-1 text-[0.6875rem] text-destructive">{submit_error}</p> : null}</div>
    <footer className="interaction-card-actions"><div className="approval-actions">{pending ? <><button type="button" className="approval-action reject" disabled={Boolean(submitting)} onClick={() => void submit("denied")}>{submitting === "deny" ? <TbLoader2 className="animate-spin" /> : <TbX />}<span>{translate("chat:activity.deny")}</span></button><button type="button" className="approval-action approve" disabled={Boolean(submitting)} onClick={() => void submit("approved")}>{submitting === "approve" ? <TbLoader2 className="animate-spin" /> : <TbCheck />}<span>{translate("chat:activity.allow")}</span></button></> : <span className="interaction-terminal-label">{approval_result_label(part)}</span>}</div></footer>
  </section>;
}

/** 多问题逐题导航卡片。 */
function QuestionCard({ part, respond }: { /** Question Interaction。 */ part: SessionAgentInteraction; /** 提交回答。 */ respond(input: RespondSessionInteractionInput): Promise<void> }) {
  const [answers, set_answers] = useState<Record<string, string | string[]>>(() => read_question_answers(part));
  const [note, set_note] = useState(() => read_interaction_note(part));
  const [current_index, set_current_index] = useState(0);
  const [submitting, set_submitting] = useState(false);
  const [submit_error, set_submit_error] = useState("");
  const request = part.request;
  const questions = interaction_questions(request);
  const question = questions[current_index];
  const pending = part.status === "pending";
  useEffect(() => {
    if (pending) return;
    set_answers(read_question_answers(part));
    set_submitting(false);
    set_submit_error("");
  }, [part.response, pending]);
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
    set_submit_error("");
    try {
      await respond({ interaction_id: part.interaction_id, response: { type: request.type, outcome: "resolved", payload: { answers: questions.map((item) => ({ question_id: item.question_id, value: answers[item.question_id] })), ...(note.trim() ? { note: note.trim() } : {}) } } });
    } catch (reason) {
      set_submit_error(reason instanceof Error ? reason.message : String(reason));
    } finally {
      set_submitting(false);
    }
  };
  return <form className="interaction-card question-interaction" aria-labelledby={`${part.interaction_id}-title`} aria-busy={submitting} onSubmit={(event) => void submit(event)}>
    <header className="interaction-card-header"><span id={`${part.interaction_id}-title`} className="interaction-card-title">{request.title || translate("chat:activity.input_required")}</span><span className="interaction-card-meta">{pending ? `${current_index + 1} / ${questions.length}` : interaction_status_label(part)}</span></header>
    <div className="interaction-card-body question-stage"><div className="question-prompt" id={`${question.question_id}-prompt`}>{question.prompt}</div><QuestionField question={question} value={answers[question.question_id]} disabled={!pending || submitting} labelled_by={`${question.question_id}-prompt`} set_value={(value) => set_answers((current) => ({ ...current, [question.question_id]: value }))} />{last ? <InteractionNote value={note} disabled={!pending || submitting} set_value={set_note} /> : null}{submit_error ? <p role="alert" className="text-[0.6875rem] text-destructive">{submit_error}</p> : null}</div>
    <footer className="interaction-card-actions"><span className="question-footer-hint">{question.response_type === "single_select" ? translate("chat:activity.single_select") : question.response_type === "multi_select" ? translate("chat:activity.multi_select") : ""}</span>{pending ? <div className="question-navigation">{current_index > 0 ? <button type="button" className="question-back" disabled={submitting} onClick={() => set_current_index((value) => value - 1)}><TbChevronLeft />{translate("chat:activity.previous")}</button> : null}<button type="submit" className="question-submit" disabled={!current_complete || submitting}>{submitting ? <TbLoader2 className="animate-spin" /> : last ? <TbSend /> : <TbChevronRight />}{translate(submitting ? "chat:activity.submitting" : last ? "chat:activity.submit" : "chat:activity.next")}</button></div> : <span className="interaction-terminal-label">{question_result_label(part)}</span>}</footer>
  </form>;
}

/** 单个问题的文本、单选或多选输入。 */
function QuestionField({ question, value, disabled, labelled_by, set_value }: { /** 当前问题。 */ question: SessionInteractionQuestion; /** 当前回答。 */ value?: string | string[]; /** 是否禁用。 */ disabled: boolean; /** 提示文案元素标识。 */ labelled_by: string; /** 更新回答。 */ set_value(value: string | string[]): void }) {
  if (question.response_type === "text") return <textarea className="question-text-input" aria-labelledby={labelled_by} disabled={disabled} value={typeof value === "string" ? value : ""} onChange={(event) => set_value(event.target.value)} />;
  return <fieldset className="question-options" aria-labelledby={labelled_by}><legend className="sr-only">{question.prompt}</legend>{question.options?.map((option) => {
    const checked = Array.isArray(value) ? value.includes(option.value) : value === option.value;
    return <label key={option.value} className={cn("question-option", checked && "is-selected")}><input disabled={disabled} type={question.response_type === "multi_select" ? "checkbox" : "radio"} name={question.question_id} checked={checked} onChange={() => {
      if (question.response_type === "single_select") set_value(option.value);
      else { const current = Array.isArray(value) ? value : []; set_value(checked ? current.filter((item) => item !== option.value) : [...current, option.value]); }
    }} /><span><span className="question-option-label">{option.label}</span>{option.description ? <span className="question-option-description">{option.description}</span> : null}</span></label>;
  })}</fieldset>;
}

/** Interaction 提交前可选的补充说明。 */
function InteractionNote({ value, disabled, set_value }: { value: string; disabled: boolean; set_value(value: string): void }) {
  return <textarea className="interaction-note-input" aria-label={translate("chat:activity.additional_note")} placeholder={translate("chat:activity.additional_note_placeholder")} rows={2} disabled={disabled} value={value} onChange={(event) => set_value(event.target.value)} />;
}

/** 未注册业务类型的只读终态或占位卡片。 */
function GenericInteractionCard({ part }: { /** 未注册 Renderer 的动态 Interaction。 */ part: SessionAgentInteraction }) {
  return <section className="interaction-card" aria-labelledby={`${part.interaction_id}-title`}><header className="interaction-card-header"><span id={`${part.interaction_id}-title`} className="interaction-card-title">{resolve_agent_interaction_title(part)}</span><span className="interaction-card-meta">{interaction_status_label(part)}</span></header><div className="interaction-card-body">{translate("chat:activity.custom_required", { type: part.request.type })}</div></section>;
}

/** 从已持久化响应中恢复问题答案。 */
function read_question_answers(part: SessionAgentInteraction): Record<string, string | string[]> {
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

function read_interaction_note(part: SessionAgentInteraction): string { const payload = part.response?.payload; if (!payload || typeof payload !== "object" || Array.isArray(payload)) return ""; const record = payload as { note?: unknown; reason?: unknown }; return typeof record.note === "string" ? record.note : typeof record.reason === "string" ? record.reason : ""; }
function is_answer_complete(value: string | string[] | undefined): value is string | string[] { return Array.isArray(value) ? value.length > 0 : typeof value === "string" && Boolean(value.trim()); }
function format_value(value: unknown): string { if (typeof value === "string") return value; try { return JSON.stringify(value, null, 2) ?? ""; } catch { return String(value); } }
function interaction_status_label(part: SessionAgentInteraction): string { return translate(`chat:activity.${part.status === "resolved" ? "responded" : part.status === "failed" ? "failed" : part.status}`); }
function approval_result_label(part: SessionAgentInteraction): string {
  const payload = part.response?.payload;
  const decision = payload && typeof payload === "object" && !Array.isArray(payload) ? (payload as { decision?: unknown }).decision : undefined;
  return translate(`chat:activity.${decision === "approved" ? "approved" : part.status === "expired" ? "expired" : part.status === "cancelled" ? "cancelled" : part.status === "failed" ? "failed" : "denied"}`);
}
function question_result_label(part: SessionAgentInteraction): string { return translate(`chat:activity.${part.status === "expired" ? "expired" : part.status === "cancelled" ? "cancelled" : "answered"}`); }
function interaction_payload(request: SessionAgentInteraction["request"]): Record<string, unknown> { return request.payload && typeof request.payload === "object" && !Array.isArray(request.payload) ? request.payload as Record<string, unknown> : {}; }
function interaction_questions(request: SessionAgentInteraction["request"]): SessionInteractionQuestion[] { const questions = interaction_payload(request).questions; return Array.isArray(questions) ? questions as SessionInteractionQuestion[] : []; }
function string_value(value: unknown): string | undefined { return typeof value === "string" && value ? value : undefined; }
