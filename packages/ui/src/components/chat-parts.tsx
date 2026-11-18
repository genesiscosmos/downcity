/** 默认消息部件：顺序、活动与交互展示由消息组件和 ChatPanel 共同消费。 */
import { useState, type ReactNode } from "react";
import { ChevronDown, File, LoaderCircle, Send } from "lucide-react";
import { TbCheck, TbChevronRight, TbFile as TbFileIcon, TbTerminal } from "./chat-icons";
import { cn } from "../lib/utils";
import { ChatInbox } from "./chat-inbox";
import { MarkdownView } from "./markdown/MarkdownView";
import type { DowncityChatChangedFile, DowncityChatContentPart, DowncityChatMessagePart, DowncityChatPanelProps, DowncityChatQuestion } from "../types/chat";
function format_value(value: unknown): string {
  if (typeof value === "string") return value;
  if (value == null) return "";
  try { return JSON.stringify(value, null, 2); } catch { return String(value); }
}

function ThinkingDots() {
  return <span className="dc-chat-thinking-dots" aria-hidden>{Array.from({ length: 6 }, (_, index) => <i key={index} />)}</span>;
}

function ToolActivity({ part }: { part: DowncityChatContentPart }) {
  const is_generating = part.tool_state === "input-streaming";
  const is_running = part.tool_state === "running" || is_generating;
  const is_failed = part.tool_state === "failed" || Boolean(part.error);
  const is_file_tool = /write|edit|patch|file/i.test(part.tool_name ?? "");
  const is_write = part.tool_name === "write";
  const state_label = is_failed ? "失败"
    : is_generating ? (is_write ? "生成文件内容中" : "生成参数中")
    : part.tool_state === "ready" ? "等待执行"
    : part.tool_state === "running" ? (is_write ? "写入文件中" : "执行中")
    : part.tool_state === "completed" ? "已完成" : "等待处理";
  const input_text = part.input_text ?? (typeof part.input === "string" ? part.input : "");
  return (
    <details className={cn("dc-chat-activity-row", is_running && "is-running", is_failed && "is-failed")} open={part.tool_state === "input-streaming"}>
      <summary className="dc-chat-activity-summary">
        <span className="dc-chat-activity-main">
          {is_file_tool ? <TbFileIcon /> : <TbTerminal />}
          <span className="dc-chat-activity-state">{state_label}</span>
          {is_generating ? <span className="dc-chat-activity-progress">已接收 {input_text.length.toLocaleString()} 字符</span> : null}
          <span className="dc-chat-activity-name">{part.tool_display_name ?? part.tool_name ?? "工具调用"}</span>
          <TbChevronRight className="dc-chat-activity-chevron" />
        </span>
      </summary>
      <div className="dc-chat-activity-terminal">
        {part.interaction_id ? <div className="dc-chat-tool-interaction"><strong>{part.title ?? (part.interaction_type === "approval" ? "需要批准" : "需要输入")}</strong><span>{part.description}</span></div> : null}
        {part.input !== undefined || input_text ? <pre><span className="dc-chat-command-prompt">› input</span>{"\n"}{is_generating ? input_text : format_value(part.input)}{is_generating ? <span className="dc-chat-input-caret" /> : null}</pre> : null}
        {part.output !== undefined || part.error ? <pre><span className="dc-chat-command-prompt">› output</span>{"\n"}{part.error ?? format_value(part.output)}</pre> : null}
      </div>
    </details>
  );
}

function ReasoningActivity({ part }: { part: DowncityChatContentPart }) {
  const is_running = part.state === "streaming" || part.state === "running";
  return <details className={cn("dc-chat-activity-row", "dc-chat-reasoning-row", is_running && "is-running")}>
    <summary className="dc-chat-activity-summary"><span className="dc-chat-activity-main">{is_running ? <ThinkingDots /> : <TbCheck />}<span className="dc-chat-activity-state">{is_running ? "正在思考" : "已思考"}</span><span className="dc-chat-activity-name">{part.text?.replace(/\s+/g, " ").trim()}</span><TbChevronRight className="dc-chat-activity-chevron" /></span></summary>
    <div className="dc-chat-reasoning-content">{part.text}</div>
  </details>;
}

function InteractionCard({ part, on_respond_interaction }: { part: DowncityChatContentPart; on_respond_interaction?: DowncityChatPanelProps["on_respond_interaction"] }) {
  const [submitted, set_submitted] = useState(false);
  const [submitting, set_submitting] = useState(false);
  const [error, set_error] = useState<string | null>(null);
  const [answers, set_answers] = useState<Record<string, string | string[]>>({});
  if (submitted || (part.interaction_status && part.interaction_status !== "pending")) return <p className="text-xs text-muted-foreground">{part.title} · {part.interaction_status ?? "submitted"}</p>;
  if (part.questions?.some(question => question.response_type === "secret")) return <section className="dc-chat-interaction-card"><header>{part.title}</header><p className="p-3 text-xs">This question requires a private input host. Configure render_interaction with the Agent private submission API.</p></section>;
  if (part.interaction_type !== "approval" && part.interaction_type !== "question") {
    return <section className="dc-chat-interaction-card" aria-label="需要操作"><header><span>{part.title ?? part.interaction_type ?? "需要操作"}</span><small>{part.interaction_status ?? "等待响应"}</small></header><div className="dc-chat-interaction-body"><p>{part.description}</p><p>此交互类型由宿主应用自定义呈现。</p></div></section>;
  }
  const questions = part.questions ?? [];
  const has_empty_answer = questions.some((question) => {
    const value = answers[question.id];
    return Array.isArray(value) ? value.length === 0 : !value?.trim();
  });
  const respond = async (response: unknown) => {
    if (!part.interaction_id) return;
    set_submitting(true);
    set_error(null);
    try {
      if (!on_respond_interaction) throw new Error("No interaction responder is connected");
      await on_respond_interaction(part.interaction_id, response);
      set_answers({});
      set_submitted(true);
    } catch (reason) {
      set_error(String(reason));
    } finally {
      set_submitting(false);
    }
  };
  return <section className="dc-chat-interaction-card" aria-label={typeof part.title === "string" ? part.title : "需要操作"}>
    <header><span>{part.title ?? (part.interaction_type === "approval" ? "需要批准" : "需要输入")}</span><small>{submitting ? "提交中" : part.interaction_status ?? "等待响应"}</small></header>
    <div className="dc-chat-interaction-body">{part.description}{questions.map((question) => <QuestionField key={question.id} question={question} value={answers[question.id] ?? (question.response_type === "multi_select" ? [] : "")} on_change={(value) => set_answers((current) => ({ ...current, [question.id]: value }))} />)}{error ? <small className="dc-chat-interaction-error">{error}</small> : null}</div>
    <footer>{part.interaction_type === "approval" ? <><button type="button" disabled={submitting || !on_respond_interaction} onClick={() => void respond({ type: "approval", outcome: "denied", payload: { decision: "denied" } })}>拒绝</button><button type="button" className="is-primary" disabled={submitting || !on_respond_interaction} onClick={() => void respond({ type: "approval", outcome: "resolved", payload: { decision: "approved" } })}>批准</button></> : <button type="button" className="is-primary" disabled={submitting || !on_respond_interaction || questions.length === 0 || has_empty_answer} onClick={() => void respond({ type: part.interaction_type ?? "question", outcome: "resolved", payload: { answers: questions.map((question) => ({ question_id: question.id, value: answers[question.id] })) } })}><Send />提交</button>}</footer>
  </section>;
}

function QuestionField({ question, value, on_change }: { question: DowncityChatQuestion; value: string | string[]; on_change: (value: string | string[]) => void }) {
  if (question.response_type === "text") return <label className="dc-chat-question"><span>{question.prompt}</span><textarea value={String(value)} onChange={(event) => on_change(event.target.value)} /></label>;
  const selected_values = Array.isArray(value) ? value : value ? [value] : [];
  return <fieldset className="dc-chat-question"><legend>{question.prompt}</legend>{question.options?.map((option) => <label key={option.value}><input type={question.response_type === "multi_select" ? "checkbox" : "radio"} name={question.id} value={option.value} checked={selected_values.includes(option.value)} onChange={() => on_change(question.response_type === "multi_select" ? selected_values.includes(option.value) ? selected_values.filter((item) => item !== option.value) : [...selected_values, option.value] : option.value)} />{option.label}</label>)}</fieldset>;
}

function ChangedFiles({ files = [] }: { files?: DowncityChatChangedFile[] }) {
  const additions = files.reduce((sum, file) => sum + file.additions, 0);
  const deletions = files.reduce((sum, file) => sum + file.deletions, 0);
  if (!files.length) return null;
  return <details className="dc-chat-changed-files" open><summary><span>已更改 {files.length} 个文件</span><b>+{additions}</b><em>-{deletions}</em><ChevronDown /></summary><div>{files.map((file) => <details key={file.path}><summary><File /><span>{file.path}</span><b>+{file.additions}</b><em>-{file.deletions}</em></summary>{file.diff ? <pre>{file.diff}</pre> : null}</details>)}</div></details>;
}

function render_part(part: DowncityChatMessagePart, on_respond_interaction?: DowncityChatPanelProps["on_respond_interaction"], render_interaction?: DowncityChatPanelProps["render_interaction"], streaming = false): ReactNode {
  if (part.type === "inbox") return <ChatInbox part={part} />;
  if (part.type === "text") return <MarkdownView text={part.text ?? ""} mode={streaming && part.state === "streaming" ? "streaming" : "static"} layout="embedded" />;
  if (part.type === "reasoning") return <ReasoningActivity part={part} />;
  if (part.type === "tool") return <ToolActivity part={part} />;
  if (part.type === "interaction") return render_interaction?.({ part, on_respond_interaction }) ?? <InteractionCard part={part} on_respond_interaction={on_respond_interaction} />;
  if (part.type === "changed-files") return <ChangedFiles files={part.files} />;
  if (part.type === "operation") return <div className="dc-chat-operation"><LoaderCircle className={part.operation?.status === "running" ? "animate-spin" : ""} /><span>{part.operation?.label ?? part.operation?.name}</span></div>;
  if (part.type === "file") return <a className="dc-chat-attachment" href={part.url} target="_blank" rel="noreferrer"><File />{part.filename ?? "附件"}</a>;
  if (part.type === "data" && part.data_type && ["reference", "task_result", "file-reference", "session-reference"].includes(part.data_type)) return <details className="text-xs"><summary>{part.data_type}</summary><pre className="whitespace-pre-wrap">{format_value(part.data)}</pre></details>;
  if (part.type === "source") return <a className="dc-chat-source" href={part.source_url} target="_blank" rel="noreferrer">{part.source_title ?? part.source_url}</a>;
  return null;
}

/** 按 Duobox MessageRenderer 的规则，把连续的 reasoning/tool/step-start 合并成一个 activity 区块。 */
export function render_message_parts(parts: DowncityChatMessagePart[], on_respond_interaction?: DowncityChatPanelProps["on_respond_interaction"], render_interaction?: DowncityChatPanelProps["render_interaction"], streaming = false): ReactNode[] {
  const nodes: ReactNode[] = [];
  let activity: DowncityChatMessagePart[] = [];
  const flush_activity = () => {
    if (!activity.length) return;
    nodes.push(<div className="dc-chat-activity-list" key={`activity-${nodes.length}`}>{activity.map((part) => <div className="dc-chat-part" key={part.id}>{render_part(part, on_respond_interaction, render_interaction, streaming)}</div>)}</div>);
    activity = [];
  };
  for (const part of parts) {
    if (part.type === "reasoning" || part.type === "tool" || part.type === "step-start") activity.push(part);
    else { flush_activity(); nodes.push(<div className="dc-chat-part" key={part.id}>{render_part(part, on_respond_interaction, render_interaction, streaming)}</div>); }
  }
  flush_activity();
  return nodes;
}
