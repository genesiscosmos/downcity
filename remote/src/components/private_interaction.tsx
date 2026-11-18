/** 私密问答宿主：按原身份获取 canonical 表单，明文提交交给专用连接适配器。 */
import { useEffect, useRef, useState } from "react";
import type { AgentInteraction as Agent_interaction_snapshot } from "@downcity/agent";
import type { Private_interaction_props } from "../types/components";

/** 仅挂载待响应的私密表单，卸载时自然释放临时输入，不生成明文历史消息。 */
export function Private_interaction({ session_id, part, read_interaction, respond, locale }: Private_interaction_props) {
  const [item, set_item] = useState<Agent_interaction_snapshot>();
  const [error, set_error] = useState<string>();
  const [answers, set_answers] = useState<Record<string, string | string[]>>({});
  const [submitting, set_submitting] = useState(false);
  const [submitted, set_submitted] = useState(false);
  const submitting_ref = useRef(false);
  const text = (en: string, zh: string) => locale === "zh" ? zh : en;
  useEffect(() => {
    let cancelled = false;
    if (!part.interaction_id) return;
    void read_interaction(session_id, part.interaction_id).then(item => {
      if (!cancelled) { set_item(item); if (!item?.can_respond) set_error(text("This question is no longer awaiting a response.", "此问题已不再等待回答。")); }
    }).catch(() => { if (!cancelled) set_error(text("Unable to load this question. Reconnect to try again.", "无法读取此问题，请重新连接后再试。")); });
    return () => { cancelled = true; };
  }, [session_id, part.interaction_id, read_interaction, locale]);

  if (part.interaction_status !== "pending") return <p className="text-xs text-muted-foreground">{part.title} · {part.interaction_status}</p>;
  if (error) return <p className="form-error" role="alert">{error}</p>;
  if (!item) return <p className="text-xs text-muted-foreground" role="status">{text("Loading private question…", "正在读取私密问题…")}</p>;
  if (submitted) return null;
  const questions = part.questions ?? [];
  const complete = questions.length > 0 && questions.every(question => {
    const value = answers[question.id];
    return Array.isArray(value) ? value.length > 0 : Boolean(value?.trim());
  });
  return <form className="remote-private-question" aria-label={typeof part.title === "string" ? part.title : text("Private question", "私密问题")} aria-busy={submitting} onSubmit={event => {
    event.preventDefault();
    if (!complete || !respond || submitting_ref.current) return;
    submitting_ref.current = true;
    set_submitting(true);
    const response = { type: item.interaction.request.type, outcome: "resolved", payload: {
      answers: questions.map(question => ({ question_id: question.id, value: answers[question.id] })),
    } };
    void Promise.resolve().then(() => respond(item.reference.interaction_id, response)).then(() => set_submitted(true)).catch(() => {
      // 私密响应失败不回显服务端错误，避免意外暴露输入。
      set_error(text("Unable to submit. Reconnect and try again.", "提交失败，请重新连接后再试。"));
    }).finally(() => { set_answers({}); set_submitting(false); submitting_ref.current = false; });
  }}>
    {part.title ? <p>{part.title}</p> : null}
    {questions.map(question => <fieldset key={question.id} disabled={submitting}>
      <legend>{question.prompt}</legend>
      {question.response_type === "single_select" || question.response_type === "multi_select" ? question.options?.map(option => {
        const current = answers[question.id];
        const checked = Array.isArray(current) ? current.includes(option.value) : current === option.value;
        return <label key={option.value} className="private-question-option"><input type={question.response_type === "multi_select" ? "checkbox" : "radio"} name={question.id} checked={checked} onChange={() => set_answers(previous => ({ ...previous, [question.id]: question.response_type === "multi_select"
          ? checked ? (Array.isArray(current) ? current : []).filter(value => value !== option.value) : [...(Array.isArray(current) ? current : []), option.value]
          : option.value }))} /><span>{option.label}</span></label>;
      }) : <input aria-label={question.prompt} type={question.response_type === "secret" ? "password" : "text"} autoComplete="off" spellCheck={false} value={typeof answers[question.id] === "string" ? answers[question.id] : ""} onChange={event => set_answers(previous => ({ ...previous, [question.id]: event.target.value }))} />}
    </fieldset>)}
    <button className="primary-button" type="submit" disabled={!complete || submitting || !respond}>{submitting ? text("Submitting…", "正在提交…") : text("Submit", "提交")}</button>
  </form>;
}
