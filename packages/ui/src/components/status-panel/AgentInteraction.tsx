"use client";
/** 待处理区的审批、问题表单，以及消息中的只读交互结果；canonical 数据负责最终状态。 */

import { useEffect, useRef, useState, type FormEvent } from "react";
import type { RespondSessionInteractionInput, SessionAgentInteraction, SessionInteractionQuestion } from "@downcity/type";
import { TbCheck, TbChevronLeft, TbChevronRight, TbLoader2, TbX } from "react-icons/tb";
import { StatusPanelButton } from "./status-panel-button";
import { Input } from "../input";
import { Textarea } from "../textarea";

import { ControlMessagesProvider, use_control_translation, default_control_translate } from "../../lib/control-messages";
import type { ChatControlTranslate } from "../../types/chat-controls";
import type { AgentInteractionProps, InteractionNoteProps, QuestionFieldProps } from "../../types/agent-interaction";

/** 根据 canonical Interaction 类型选择对应交互界面。 */
function AgentInteractionContent({ part, respond, read_only = false, answer_placeholder, presentation = "chat", external_heading }: AgentInteractionProps) {
  const [submitted, set_submitted] = useState(false);
  const responding_ref = useRef(false);
  const submit_response: AgentInteractionProps["respond"] = async (input, private_question) => {
    if (responding_ref.current) return;
    responding_ref.current = true;
    try {
      await respond(input, private_question);
      set_submitted(true);
    } catch (reason) {
      responding_ref.current = false;
      throw reason;
    }
  };
  if (part.status === "pending" && submitted && !read_only) return null;
  if (read_only || part.status !== "pending") return <InteractionResult part={part} />;
  if (part.request.type === "approval") return <ApprovalCard key={part.interaction_id} part={part} respond={submit_response} presentation={presentation} external_heading={external_heading} />;
  if (part.request.type === "question") return <QuestionCard key={part.interaction_id} part={part} respond={submit_response} answer_placeholder={answer_placeholder} presentation={presentation} external_heading={external_heading} />;
  return <GenericInteractionCard part={part} />;
}

/** 返回 Interaction 在 Activity 摘要中的稳定标题。 */
export function resolve_agent_interaction_title(part: SessionAgentInteraction, translate: ChatControlTranslate = default_control_translate): string {
  return part.request.title || (part.request.type === "approval"
    ? translate("chat:activity.confirmation")
    : part.request.type === "question"
      ? translate("chat:activity.input_required")
      : part.request.type);
}

/** 高风险操作审批卡片。 */
function ApprovalCard({ part, respond, presentation, external_heading }: AgentInteractionProps) {
  const translate = use_control_translation();
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
  const validated_input = payload.validated_input;
  // 编程执行直接展示完整源码，审批对象就是随后运行的这一份代码。
  const execute_code = request.source.tool_name === "context.execute" && validated_input && typeof validated_input === "object" && !Array.isArray(validated_input) ? string_value((validated_input as Record<string, unknown>).code) : undefined;
  const detail = execute_code ?? (operation === "tool" ? format_value(validated_input) : string_value(payload.command));
  const description = operation === "tool" ? string_value(payload.model_explanation) || string_value(payload.tool_description) : request.description || string_value(payload.reason);
  const heading_id = presentation === "input" ? external_heading?.title_id : undefined;
  return <section className="interaction-card approval-interaction" data-presentation={presentation} aria-labelledby={heading_id ?? `${part.interaction_id}-title`} aria-busy={Boolean(submitting)}>
    {!heading_id || description ? <header className="interaction-card-header">
      <div className="interaction-heading">{!heading_id ? <span id={`${part.interaction_id}-title`} className="interaction-card-title">{request.title || translate("chat:activity.confirmation")}</span> : null}{description ? <p className="approval-card-message">{description}</p> : null}</div>
    </header> : null}
    {detail ? execute_code || presentation === "input"
      ? <pre className="interaction-command interaction-command-standalone">{detail}</pre>
      : <details className="interaction-command"><summary aria-label={translate("chat:attachment.show_details")}><code>{detail}</code></summary><pre>{detail}</pre></details> : null}
    {presentation === "input" ? <>
      <InteractionNote value={note} disabled={Boolean(submitting)} set_value={set_note} />
      {submit_error ? <p role="alert" className="interaction-error">{submit_error}</p> : null}
      <footer className="interaction-card-actions interaction-approval-actions">
        <StatusPanelButton variant="primary" size="chat-action" disabled={Boolean(submitting)} aria-busy={submitting === "approve"} onClick={() => void submit("approved")}>{submitting === "approve" ? <TbLoader2 aria-hidden="true" className="animate-spin" /> : <TbCheck aria-hidden="true" />}{translate("chat:activity.allow")}</StatusPanelButton>
        <StatusPanelButton size="chat-action" disabled={Boolean(submitting)} aria-busy={submitting === "deny"} onClick={() => void submit("denied")}>{submitting === "deny" ? <TbLoader2 aria-hidden="true" className="animate-spin" /> : <TbX aria-hidden="true" />}{translate("chat:activity.deny")}</StatusPanelButton>
      </footer>
    </> : <>
      <Input className="approval-note-input" aria-label={translate("chat:activity.additional_note")} placeholder={translate("chat:activity.additional_note_placeholder")} disabled={Boolean(submitting)} value={note} onChange={(event) => set_note(event.target.value)} />
      <footer className="interaction-navigation">
        <StatusPanelButton variant="primary" size="chat-action" disabled={Boolean(submitting)} onClick={() => void submit("approved")}>{submitting === "approve" ? <TbLoader2 aria-hidden="true" className="animate-spin" /> : <TbCheck aria-hidden="true" />}{translate("chat:activity.allow")}</StatusPanelButton>
        <StatusPanelButton size="chat-action" disabled={Boolean(submitting)} onClick={() => void submit("denied")}>{submitting === "deny" ? <TbLoader2 aria-hidden="true" className="animate-spin" /> : <TbX aria-hidden="true" />}{translate("chat:activity.deny")}</StatusPanelButton>
      </footer>
      {submit_error ? <p role="alert" className="text-2xs text-destructive">{submit_error}</p> : null}
    </>}
  </section>;
}

/** 多问题逐题导航卡片。 */
function QuestionCard({ part, respond, answer_placeholder, presentation, external_heading }: AgentInteractionProps) {
  const translate = use_control_translation();
  const [answers, set_answers] = useState<Record<string, string | string[]>>(() => read_question_answers(part));
  const [note, set_note] = useState(() => read_interaction_note(part));
  const [current_index, set_current_index] = useState(0);
  const [submitting, set_submitting] = useState(false);
  const [submit_error, set_submit_error] = useState("");
  const request = part.request;
  const questions = interaction_questions(request);
  const private_question = questions.some((item) => item.type === "secret");
  const question = questions[current_index];
  const pending = part.status === "pending";
  useEffect(() => {
    if (pending) return;
    set_answers({});
    set_note("");
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
    if (!all_complete) { set_current_index(questions.findIndex((item) => !is_answer_complete(answers[item.question_id]))); return; }
    set_submitting(true);
    set_submit_error("");
    try {
      await respond({ interaction_id: part.interaction_id, response: { type: request.type, outcome: "resolved", payload: { answers: questions.map((item) => ({ question_id: item.question_id, value: answers[item.question_id] })), ...(!private_question && note.trim() ? { note: note.trim() } : {}) } } }, private_question);
    } catch (reason) {
      set_submit_error(private_question ? translate("chat:activity.private_submit_failed") : reason instanceof Error ? reason.message : String(reason));
    } finally {
      if (private_question) { set_answers({}); set_note(""); set_current_index(0); }
      set_submitting(false);
    }
  };
  const shared_heading = presentation === "input" && external_heading?.title.trim() === question.question.trim();
  const prompt_id = shared_heading ? external_heading.title_id : `${part.interaction_id}-${question.question_id}-prompt`;
  return <form className="interaction-card question-interaction" data-presentation={presentation} aria-labelledby={prompt_id} aria-busy={submitting} onSubmit={(event) => void submit(event)}>
    {!shared_heading || questions.length > 1 ? <header className="interaction-card-header">
      {!shared_heading ? <div className="question-prompt" id={prompt_id}>{question.question}</div> : null}
      {questions.length > 1 ? <nav className="interaction-navigation" aria-label={request.title || translate("chat:activity.input_required")}>
        <StatusPanelButton size="icon" aria-label={translate("chat:activity.previous")} disabled={submitting || current_index === 0} onClick={() => set_current_index((value) => value - 1)}><TbChevronLeft /></StatusPanelButton>
        <span className="interaction-page">{current_index + 1} / {questions.length}</span>
        <StatusPanelButton size="icon" aria-label={translate("chat:activity.next")} disabled={submitting || last} onClick={() => set_current_index((value) => value + 1)}><TbChevronRight /></StatusPanelButton>
      </nav> : null}
    </header> : null}
    <QuestionField question={question} placeholder={answer_placeholder} value={answers[question.question_id]} disabled={submitting} labelled_by={prompt_id} set_value={(value) => set_answers((current) => ({ ...current, [question.question_id]: value }))} />
    {presentation === "input" && !private_question ? <InteractionNote value={note} disabled={submitting} set_value={set_note} /> : null}
    {submit_error ? <p role="alert" className={presentation === "input" ? "interaction-error" : "text-2xs text-destructive"}>{submit_error}</p> : null}
    <footer className="interaction-card-actions">
      {presentation !== "input" && !private_question ? <InteractionNote value={note} disabled={submitting} set_value={set_note} /> : null}
      {presentation === "input"
        ? <StatusPanelButton variant="primary" size="action" type="submit" disabled={!current_complete || submitting} aria-busy={submitting}>{submitting ? <TbLoader2 aria-hidden="true" className="animate-spin" /> : last ? <TbCheck aria-hidden="true" /> : <TbChevronRight aria-hidden="true" />}{translate(last ? "chat:activity.submit" : "chat:activity.next")}</StatusPanelButton>
        : <StatusPanelButton variant="primary" size="chat-action" type="submit" disabled={!current_complete || submitting}>{submitting ? <TbLoader2 className="animate-spin" /> : null}{translate(submitting ? "chat:activity.submitting" : last ? "chat:activity.submit" : "chat:activity.next")}</StatusPanelButton>}
    </footer>
  </form>;
}

/** 单个问题的文本、单选或多选输入；只有 multi_select 提交数组，与 Session 的校验一致。 */
export function QuestionField({ question, value, disabled, labelled_by, set_value, placeholder }: QuestionFieldProps) {
  if (question.type === "text" || question.type === "secret") {
    return question.type === "secret"
      ? <Input className="question-text-input" aria-labelledby={labelled_by} autoComplete="off" type="password" disabled={disabled} value={typeof value === "string" ? value : ""} onChange={(event) => set_value(event.target.value)} />
      : <Textarea placeholder={placeholder} className="question-text-input" aria-labelledby={labelled_by} disabled={disabled} value={typeof value === "string" ? value : ""} onChange={(event) => set_value(event.target.value)} />;
  }
  return <fieldset className="question-options" aria-labelledby={labelled_by}><legend className="sr-only">{question.question}</legend>{question.options?.map((option) => {
    const checked = Array.isArray(value) ? value.includes(option.value) : value === option.value;

    return <label key={option.value} className="question-option"><input type={question.type === "multi_select" ? "checkbox" : "radio"} className="interaction-choice" disabled={disabled} name={labelled_by} checked={checked} onChange={() => {
      if (question.type !== "multi_select") set_value(option.value);
      else { const current = Array.isArray(value) ? value : []; set_value(checked ? current.filter((item) => item !== option.value) : [...current, option.value]); }
    }} /><span><span className="question-option-label">{option.label}</span>{option.description ? <span className="question-option-description">{option.description}</span> : null}</span></label>;
  })}</fieldset>;
}

/** 可选补充说明由展示上下文决定位置；Inbox 独占一行，聊天保留原操作栏布局。 */
function InteractionNote({ value, disabled, set_value }: InteractionNoteProps) {
  const translate = use_control_translation();
  return <Input className="interaction-note-input" aria-label={translate("chat:activity.additional_note")} placeholder={translate("chat:activity.additional_note_placeholder")} disabled={disabled} value={value} onChange={(event) => set_value(event.target.value)} />;
}

/** 只读记录显示真实终态，已回答的问题按标签回显，避免重复渲染可编辑表单。 */
function InteractionResult({ part }: Pick<AgentInteractionProps, "part">) {
  const translate = use_control_translation();
  const answers = read_question_answers(part);
  const questions = interaction_questions(part.request);
  const note = read_interaction_note(part);
  const status = part.request.type === "approval" ? approval_result_label(part, translate) : interaction_status_label(part, translate);
  return <section className="interaction-card">
    <header className="interaction-card-header"><span className="interaction-card-title">{resolve_agent_interaction_title(part, translate)}</span><span className="interaction-card-meta">{status}</span></header>
    {questions.some((question) => is_answer_complete(answers[question.question_id])) ? <dl className="interaction-answer-list">{questions.map((question) => {
      const value = answers[question.question_id];
      if (!is_answer_complete(value)) return null;
      const values = Array.isArray(value) ? value : [value];
      const text = question.type === "secret"
        ? translate("chat:activity.private_value_provided")
        : values.map((item) => question.options?.find((option) => option.value === item)?.label ?? item).join("、");
      return <div key={question.question_id}><dt>{question.question}</dt><dd>{text}</dd></div>;
    })}</dl> : null}
    {note ? <p className="approval-card-message">{note}</p> : null}
  </section>;
}

/** 未注册业务类型的只读终态或占位卡片。 */
function GenericInteractionCard({ part }: Pick<AgentInteractionProps, "part">) {
  const translate = use_control_translation();
  return <section className="interaction-card" aria-labelledby={`${part.interaction_id}-title`}><header className="interaction-card-header"><span id={`${part.interaction_id}-title`} className="interaction-card-title">{resolve_agent_interaction_title(part, translate)}</span><span className="interaction-card-meta">{interaction_status_label(part, translate)}</span></header><div className="interaction-card-body">{translate("chat:activity.custom_required", { type: part.request.type })}</div></section>;
}

/** 从已持久化响应中恢复问题答案。 */
function read_question_answers(part: SessionAgentInteraction): Record<string, string | string[]> {
  const payload = part.response?.payload;
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return {};
  const answers = (payload as Record<string, unknown>).answers;
  if (!Array.isArray(answers)) return {};
  return Object.fromEntries(answers.flatMap((answer) => {
    if (!answer || typeof answer !== "object" || Array.isArray(answer)) return [];
    const item = answer as Record<string, unknown>;
    return typeof item.question_id === "string" && (typeof item.value === "string" || Array.isArray(item.value))
      ? [[item.question_id, item.value as string | string[]]]
      : [];
  }));
}

function read_interaction_note(part: SessionAgentInteraction): string { const payload = part.response?.payload; if (!payload || typeof payload !== "object" || Array.isArray(payload)) return ""; const record = payload as Record<string, unknown>; return typeof record.note === "string" ? record.note : typeof record.reason === "string" ? record.reason : ""; }
function is_answer_complete(value: string | string[] | undefined): value is string | string[] { return Array.isArray(value) ? value.length > 0 : typeof value === "string" && Boolean(value.trim()); }
function format_value(value: unknown): string { if (typeof value === "string") return value; try { return JSON.stringify(value, null, 2) ?? ""; } catch { return String(value); } }
function interaction_status_label(part: SessionAgentInteraction, translate: ChatControlTranslate = default_control_translate): string { return translate(`chat:activity.${part.status === "resolved" ? "responded" : part.status === "failed" ? "failed" : part.status}`); }
function approval_result_label(part: SessionAgentInteraction, translate: ChatControlTranslate = default_control_translate): string {
  const payload = part.response?.payload;
  const decision = payload && typeof payload === "object" && !Array.isArray(payload) ? (payload as Record<string, unknown>).decision : undefined;
  return translate(`chat:activity.${decision === "approved" ? "approved" : part.status === "cancelled" ? "cancelled" : part.status === "failed" ? "failed" : "denied"}`);
}
function interaction_payload(request: SessionAgentInteraction["request"]): Record<string, unknown> { return request.payload && typeof request.payload === "object" && !Array.isArray(request.payload) ? request.payload as Record<string, unknown> : {}; }
function interaction_questions(request: SessionAgentInteraction["request"]): SessionInteractionQuestion[] { const questions = interaction_payload(request).questions; return Array.isArray(questions) ? questions as SessionInteractionQuestion[] : []; }function string_value(value: unknown): string | undefined { return typeof value === "string" && value ? value : undefined; }

/** 公共交互边界，交互切换时按完整身份卸载临时表单。 */
export function AgentInteraction(props: AgentInteractionProps) {
  return <ControlMessagesProvider translate={props.translate}><AgentInteractionContent key={props.part.interaction_id} {...props} /></ControlMessagesProvider>;
}

/** 独立审批卡片，沿用完整交互的生命周期与提交去重。 */
export function ApprovalInteractionCard(props: AgentInteractionProps) {
  return props.part.request.type === "approval" ? <AgentInteraction {...props} /> : null;
}
/** 独立问题卡片，支持文字、私密值、单选、多选和逐题导航。 */
export function QuestionInteractionCard(props: AgentInteractionProps) {
  return props.part.request.type === "question" ? <AgentInteraction {...props} /> : null;
}
