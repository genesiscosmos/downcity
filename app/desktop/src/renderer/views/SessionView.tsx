/** Downcity Session Chat 主视图，交互语义与 Duobox ChatCore 保持一致。 */

import { useEffect, useRef, useState, type FormEvent } from "react";
import type {
  RespondSessionInteractionInput,
  SessionAssistantInteractionPart,
  SessionAssistantMessagePart,
  SessionMessage,
} from "@downcity/agent";
import { Streamdown } from "streamdown";
import {
  TbArrowUp,
  TbAlertCircle,
  TbBulb,
  TbChecklist,
  TbCheck,
  TbChevronRight,
  TbCopy,
  TbFile,
  TbLoader2,
  TbRoute,
  TbSearch,
  TbTool,
  TbWriting,
} from "react-icons/tb";
import { Button } from "@/components/ui/button";
import { ChatInputEditor } from "@/lib/chat/ChatInputEditor";
import { MainViewBody, MainViewLayout } from "@/layouts/MainViewLayout";
import { cn } from "@/lib/utils";
import { is_chat_busy, type ChatHistoryState, type QueuedChatMessage } from "@/types/DesktopView";
import type { DesktopAgentSummary, DesktopChatFileInput, DesktopChatInput, DesktopChatRuntime, DesktopModelSummary, DesktopSessionConfiguration, DesktopSessionSummary, DesktopSettings } from "@common/types/DesktopApi";

/** Session Chat 主视图属性。 */
interface SessionViewProps {
  /** Session 所属 Agent。 */
  agent: DesktopAgentSummary;
  /** 当前 Session 摘要。 */
  session: DesktopSessionSummary;
  /** 当前 Session 的 canonical 可见消息。 */
  messages: SessionMessage[];
  /** 当前 Session 实时运行态。 */
  runtime?: DesktopChatRuntime;
  /** 当前 Session 输入草稿。 */
  draft: string;
  /** 当前 Session 附件草稿。 */
  draft_files: DesktopChatFileInput[];
  /** 当前 Session 待发送队列。 */
  queued_messages: QueuedChatMessage[];
  /** 当前 Session 更早历史分页状态。 */
  history?: ChatHistoryState;
  /** Desktop Chat 设置。 */
  settings: DesktopSettings;
  /** 当前 Federation 模型目录。 */
  models: DesktopModelSummary[];
  /** 当前 Session 模型与审批配置。 */
  configuration?: DesktopSessionConfiguration;
  /** 模型目录是否正在读取。 */
  models_loading: boolean;
  /** 更新当前输入草稿。 */
  update_draft(text: string): void;
  /** 更新当前附件草稿。 */
  update_draft_files(files: DesktopChatFileInput[]): void;
  /** 发送或排队一条消息。 */
  send_message(input: DesktopChatInput): Promise<void>;
  /** 刷新模型目录。 */
  refresh_models(): Promise<void>;
  /** 切换当前模型。 */
  set_model(model_id: string): Promise<void>;
  /** 切换当前审批模式。 */
  set_approval_mode(approval_mode: DesktopSessionConfiguration["approval_mode"]): Promise<void>;
  /** 停止当前 Turn。 */
  stop_session(): Promise<void>;
  /** 响应当前审批或问题。 */
  respond_interaction(input: RespondSessionInteractionInput): Promise<void>;
  /** 删除尚未发送的队列项。 */
  remove_queued_message(message_id: string): void;
  /** 调整尚未发送的队列项顺序。 */
  move_queued_message(message_id: string, direction: "up" | "down"): void;
  /** 读取一个更早历史 Segment。 */
  load_earlier_history(): Promise<void>;
}

const empty_prompts = [
  { title: "写作与创作", description: "帮助我完善一段文字或构思", icon: TbWriting, prompt: "帮我完善一段文字" },
  { title: "研究与分析", description: "整理信息并提炼关键结论", icon: TbSearch, prompt: "帮我分析这个问题" },
  { title: "规划项目", description: "把目标拆解成可执行的步骤", icon: TbRoute, prompt: "帮我规划一个执行方案" },
  { title: "团队协作", description: "一起梳理任务、方案和下一步", icon: TbChecklist, prompt: "帮我梳理下一步任务" },
];

/** Session 对话主视图。 */
export function SessionView(props: SessionViewProps) {
  const { session, messages, runtime, settings } = props;
  const scroll_ref = useRef<HTMLDivElement | null>(null);
  const sticky_ref = useRef(true);
  const busy = is_chat_busy(runtime);

  useEffect(() => {
    const container = scroll_ref.current;
    if (!container || !settings.auto_scroll || !sticky_ref.current) return;
    container.scrollTop = container.scrollHeight;
  }, [messages, runtime?.status, settings.auto_scroll]);

  const load_earlier = async () => {
    const container = scroll_ref.current;
    const previous_height = container?.scrollHeight ?? 0;
    await props.load_earlier_history();
    requestAnimationFrame(() => {
      if (container) container.scrollTop += container.scrollHeight - previous_height;
    });
  };

  return <MainViewLayout>
    <header className="header-drag-region flex h-10 w-full flex-none items-center gap-2 px-2">
      <div className="min-w-0 flex-1 truncate pl-1 text-xs font-medium text-foreground">{session.title || "新对话"}</div>
      {busy ? <span className="inline-flex items-center gap-1 text-[0.625rem] text-muted-foreground"><TbLoader2 className="size-3 animate-spin" />{runtime?.status === "submitted" ? "正在提交" : "正在执行"}</span> : null}
    </header>
    <MainViewBody>
      <div className="relative flex min-h-0 min-w-0 w-full flex-1 flex-col overflow-hidden bg-transparent">
        <div
          ref={scroll_ref}
          className="relative min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto"
          role="log"
          onScroll={(event) => {
            const element = event.currentTarget;
            sticky_ref.current = element.scrollHeight - element.scrollTop - element.clientHeight < 80;
          }}
        >
          <div className="mx-auto flex min-h-full min-w-0 w-full max-w-[840px] flex-col p-2">
            {props.history?.has_more ? <div className="flex justify-center py-1"><Button disabled={props.history.loading} onClick={() => void load_earlier()}><TbArrowUp />{props.history.loading ? "正在加载…" : "加载更早消息"}</Button></div> : null}
            {messages.length === 0 ? <EmptyPrompts on_select={props.update_draft} /> : null}
            {messages.map((message) => <MessageRenderer key={message.message_id} message={message} show_reasoning={settings.show_reasoning} respond_interaction={props.respond_interaction} />)}
            {busy && !has_streaming_assistant(messages) ? <ActivityIndicator status={runtime?.status} /> : null}
          </div>
        </div>

        <div className="mx-auto m-2 w-[calc(100%-1rem)] max-w-[840px] flex-none rounded-2xl bg-muted-foreground/10">
          <ChatInputEditor
            agent={props.agent}
            draft={props.draft}
            draft_files={props.draft_files}
            runtime={props.runtime}
            queued_messages={props.queued_messages}
            configuration={props.configuration}
            models={props.models}
            models_loading={props.models_loading}
            settings={props.settings}
            update_draft={props.update_draft}
            update_draft_files={props.update_draft_files}
            send_message={props.send_message}
            stop_session={props.stop_session}
            refresh_models={props.refresh_models}
            set_model={props.set_model}
            set_approval_mode={props.set_approval_mode}
            remove_queued_message={props.remove_queued_message}
            move_queued_message={props.move_queued_message}
          />
        </div>
      </div>
    </MainViewBody>
  </MainViewLayout>;
}

/** 空会话提示。 */
function EmptyPrompts({ on_select }: { /** 将预设提示放入输入框。 */ on_select(prompt: string): void }) {
  return <div className="flex min-h-[50vh] flex-col items-center justify-center gap-6 px-4">
    <p className="text-center text-sm text-muted-foreground">开始新的对话</p>
    <div className="flex w-full max-w-80 flex-col gap-1">
      {empty_prompts.map(({ title, description, icon: Icon, prompt }) => <Button key={title} size="full" className="h-auto min-h-12 items-start gap-2 rounded-md px-2.5 py-2 text-left whitespace-normal text-foreground/75" onClick={() => on_select(prompt)}>
        <Icon className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1"><span className="block text-[0.6875rem] font-medium leading-4">{title}</span><span className="mt-0.5 block text-[0.625rem] leading-3.5 text-muted-foreground">{description}</span></span>
      </Button>)}
    </div>
  </div>;
}

/** 按 canonical 消息类型渲染。 */
function MessageRenderer({ message, show_reasoning, respond_interaction }: { /** canonical 消息。 */ message: SessionMessage; /** 是否显示推理。 */ show_reasoning: boolean; /** 响应审批或问题。 */ respond_interaction(input: RespondSessionInteractionInput): Promise<void> }) {
  if (message.type === "error") return <div className="group is-assistant flex min-w-0 w-full flex-row-reverse items-end justify-end gap-2 !m-0 !p-0">
    <div className="flex min-w-0 w-full flex-col gap-0 px-2 pt-0.5 pb-0 !overflow-visible !rounded-none text-sm text-foreground">
      <div className="flex min-w-0 w-full items-start gap-2 rounded-md bg-foreground/[0.045] px-2.5 py-2">
        <TbAlertCircle className="mt-0.5 size-3.5 shrink-0 text-muted-foreground/55" />
        <p className="min-w-0 flex-1 whitespace-pre-wrap break-words text-[0.78125rem] leading-[1.55] text-muted-foreground [overflow-wrap:anywhere]">{message.message}</p>
      </div>
    </div>
  </div>;
  if (message.type === "action") return <div className="group is-assistant flex w-full flex-row-reverse items-end justify-end gap-2 !m-0 !p-0">
    <div className="flex w-full flex-col gap-0 px-1 pt-0.5 pb-0 !overflow-visible !rounded-none text-sm text-foreground">
      <div className="flex min-h-0 w-full items-center gap-3">
        <span className="h-px min-w-4 flex-1 bg-border/60" aria-hidden />
        <div className="min-w-0 max-w-[80%] text-center text-[0.8125rem] leading-[1.54] text-foreground/90">
          <span>{message.title}</span>{message.description ? <span className="ml-1.5 text-muted-foreground">{message.description}</span> : null}
        </div>
        <span className="h-px min-w-4 flex-1 bg-border/60" aria-hidden />
      </div>
    </div>
  </div>;
  if (message.type === "user") {
    const text = message.parts.flatMap((part) => part.type === "text" ? [part.text] : []).join("\n");
    return <div className="group is-user flex w-full items-end justify-end gap-2 py-2">
      <div className="w-full flex justify-end">
        <div className="user-message-stack flex w-full max-w-[min(80%,42rem)] min-w-0 flex-col items-end gap-0.5">
          <div className="ml-auto flex w-fit max-w-full flex-col gap-2 overflow-hidden rounded-2xl rounded-tr-none bg-muted-foreground/10 px-3 py-2 text-sm text-foreground">
            {text ? <div className="text-[0.8125rem] leading-[1.34]"><ChatMarkdown class_name="user-message-markdown !h-auto !w-auto break-words" text={text} mode="static" /></div> : null}
            {message.parts.flatMap((part) => part.type === "file" ? [<a key={part.part_id} href={part.url} target="_blank" rel="noreferrer" className="flex min-w-0 items-center gap-1.5 text-[0.75rem] text-foreground/80"><TbFile className="size-3.5 shrink-0" /><span className="truncate">{part.filename || "文件"}</span></a>] : [])}
          </div>
        </div>
      </div>
    </div>;
  }
  return <AssistantMessage message={message} show_reasoning={show_reasoning} respond_interaction={respond_interaction} />;
}

/** Assistant 消息与 Duobox 一致，始终保留底部活动或操作栏。 */
function AssistantMessage({ message, show_reasoning, respond_interaction }: { /** canonical Assistant 消息。 */ message: Extract<SessionMessage, { type: "assistant" }>; /** 是否显示推理。 */ show_reasoning: boolean; /** 响应审批或问题。 */ respond_interaction(input: RespondSessionInteractionInput): Promise<void> }) {
  const [copied, set_copied] = useState(false);
  const text = message.parts.flatMap((part) => part.type === "text" ? [part.text] : []).join("\n");
  const copy_message = async () => {
    if (!text) return;
    await navigator.clipboard.writeText(text);
    set_copied(true);
    window.setTimeout(() => set_copied(false), 1200);
  };
  return <div className="group is-assistant flex w-full flex-row-reverse items-end justify-end gap-2 py-2 !m-0 !p-0">
    <div className="flex w-full flex-col gap-0 overflow-visible rounded-none px-1 pb-0 pt-0.5 text-sm text-foreground">
      <div className="min-h-0 w-full">
        <AssistantParts parts={message.parts} show_reasoning={show_reasoning} respond_interaction={respond_interaction} streaming={message.status === "streaming"} />
      </div>
      {message.status === "streaming" ? <ActivityIndicator status="streaming" compact /> : <div className="assistant-message-menu-bar flex h-6 min-h-6 shrink-0 items-center pl-1">
        {text ? <div className="message-action-toolbar pointer-events-none flex h-5 items-center gap-0.5 opacity-0 transition-opacity group-hover:pointer-events-auto group-hover:opacity-100 focus-within:pointer-events-auto focus-within:opacity-100">
          <button type="button" onClick={() => void copy_message()} className="group/message-action flex size-5 items-center justify-center rounded-md bg-transparent p-0 text-primary/45 transition-colors hover:bg-primary/10 hover:text-primary/65" title="复制">{copied ? <TbCheck className="size-3 shrink-0 !text-primary/45 stroke-[1.65] group-hover/message-action:!text-primary/65" /> : <TbCopy className="size-3 shrink-0 !text-primary/45 stroke-[1.65] group-hover/message-action:!text-primary/65" />}</button>
        </div> : null}
      </div>}
    </div>
  </div>;
}

/** 按 Duobox 规则把连续 reasoning、tool 与 interaction 合并为活动日志。 */
function AssistantParts({ parts, show_reasoning, respond_interaction, streaming }: { /** Assistant 原始 parts。 */ parts: SessionAssistantMessagePart[]; /** 是否展示推理。 */ show_reasoning: boolean; /** 响应审批或问题。 */ respond_interaction(input: RespondSessionInteractionInput): Promise<void>; /** 当前消息是否流式生成。 */ streaming: boolean }) {
  const groups: SessionAssistantMessagePart[][] = [];
  for (const part of parts) {
    const activity = part.type === "reasoning" || part.type === "tool" || part.type === "interaction";
    const previous = groups[groups.length - 1];
    const previous_activity = previous?.every((item) => item.type === "reasoning" || item.type === "tool" || item.type === "interaction");
    if (activity && previous_activity) previous.push(part);
    else groups.push([part]);
  }
  return <>{groups.map((group) => {
    const activity = group.every((part) => part.type === "reasoning" || part.type === "tool" || part.type === "interaction");
    if (activity) return <div key={group[0].part_id} className="agent-process-body">{group.map((part) => <AssistantPart key={part.part_id} part={part} show_reasoning={show_reasoning} respond_interaction={respond_interaction} streaming={streaming} />)}</div>;
    const part = group[0];
    return <AssistantPart key={part.part_id} part={part} show_reasoning={show_reasoning} respond_interaction={respond_interaction} streaming={streaming} />;
  })}</>;
}

/** 渲染 assistant 的结构化 part。 */
function AssistantPart({ part, show_reasoning, respond_interaction, streaming }: { /** assistant part。 */ part: SessionAssistantMessagePart; /** 是否展示推理。 */ show_reasoning: boolean; /** 响应审批或问题。 */ respond_interaction(input: RespondSessionInteractionInput): Promise<void>; /** 当前消息是否流式生成。 */ streaming: boolean }) {
  if (part.type === "text") return part.text ? <div className="text-[0.8125rem] leading-[1.54] text-foreground/90"><ChatMarkdown class_name="min-h-[1.54em]" text={part.text} mode={streaming && part.state === "streaming" ? "streaming" : "static"} /></div> : null;
  if (part.type === "reasoning") return show_reasoning && part.text ? <details className={cn("activity-tool-row reasoning-activity-row", part.state === "streaming" ? "is-running" : "is-complete")}>
    <summary className="activity-tool-summary"><div className="activity-tool-main"><TbBulb className="activity-tool-icon" aria-hidden /><span className="activity-tool-state">{part.state === "streaming" ? "正在思考" : "已思考"}</span><span className="activity-tool-name">{part.text.replace(/\s+/g, " ").trim()}</span><TbChevronRight className="activity-tool-chevron" aria-hidden /></div></summary>
    <div className="reasoning-activity-content"><div className="reasoning-block">{part.text.trim()}</div></div>
  </details> : null;
  if (part.type === "tool") return <ToolPart part={part} />;
  if (part.type === "interaction") return <InteractionPart part={part} respond={respond_interaction} />;
  if (part.type === "file") return <a href={part.url} className="text-xs text-primary underline" target="_blank" rel="noreferrer">{part.filename || "文件"}</a>;
  if (part.type === "source") return part.source_type === "url" ? <a href={part.url} className="block truncate text-xs text-primary underline" target="_blank" rel="noreferrer">{part.title || part.url}</a> : <div className="text-xs text-muted-foreground">来源：{part.title}</div>;
  return null;
}

/** Session 内联审批与问题交互。 */
function InteractionPart({ part, respond }: { /** Interaction part。 */ part: SessionAssistantInteractionPart; /** 提交响应。 */ respond(input: RespondSessionInteractionInput): Promise<void> }) {
  const [answers, set_answers] = useState<Record<string, string | string[]>>({});
  const [submitting, set_submitting] = useState(false);
  const pending = part.status === "pending";

  const submit = async (input: RespondSessionInteractionInput) => {
    if (!pending || submitting) return;
    set_submitting(true);
    try {
      await respond(input);
    } finally {
      set_submitting(false);
    }
  };

  if (part.request.kind === "approval") {
    const request = part.request;
    return <div className="rounded-md border border-border/60 bg-surface-subtle px-3 py-2 text-xs">
      <div className="font-medium">{request.operation === "tool" ? "工具请求确认" : request.title}</div>
      {request.operation !== "tool" ? <div className="mt-1 whitespace-pre-wrap break-all text-muted-foreground">{request.command}</div> : null}
      {request.operation === "tool" && request.model_explanation ? <div className="mt-1 text-muted-foreground">{request.model_explanation}</div> : null}
      {pending ? <div className="mt-2 flex justify-end gap-1.5"><Button disabled={submitting} onClick={() => void submit({ interaction_id: part.interaction_id, response: { kind: "approval", decision: "denied" } })}>拒绝</Button><Button variant="primary" disabled={submitting} onClick={() => void submit({ interaction_id: part.interaction_id, response: { kind: "approval", decision: "approved" } })}>{submitting ? "提交中…" : "允许"}</Button></div> : <div className="mt-2 text-muted-foreground">{part.response?.kind === "approval" && part.response.decision === "approved" ? "已允许" : "已拒绝或取消"}</div>}
    </div>;
  }

  const question_request = part.request;
  if (question_request.kind !== "question") return null;

  const handle_question_submit = (event: FormEvent) => {
    event.preventDefault();
    const complete = question_request.questions.every((question) => {
      const value = answers[question.question_id];
      return Array.isArray(value) ? value.length > 0 : Boolean(value?.trim());
    });
    if (!complete) return;
    void submit({
      interaction_id: part.interaction_id,
      response: {
        kind: "question",
        answers: question_request.questions.map((question) => ({ question_id: question.question_id, value: answers[question.question_id] })),
      },
    });
  };

  return <form onSubmit={handle_question_submit} className="rounded-md border border-border/60 bg-surface-subtle px-3 py-2 text-xs">
    <div className="font-medium">{question_request.title}</div>
    <div className="mt-2 space-y-3">
      {question_request.questions.map((question) => <fieldset key={question.question_id} disabled={!pending || submitting}>
        <legend className="mb-1 text-muted-foreground">{question.prompt}</legend>
        {question.response_type === "text" ? <input className="h-8 w-full rounded-md bg-background px-2 ring-1 ring-border" value={typeof answers[question.question_id] === "string" ? answers[question.question_id] : ""} onChange={(event) => set_answers((current) => ({ ...current, [question.question_id]: event.target.value }))} /> : null}
        {question.options?.map((option) => {
          const current = answers[question.question_id];
          const checked = Array.isArray(current) ? current.includes(option.value) : current === option.value;
          return <label key={option.value} className="mt-1 flex cursor-pointer items-start gap-2 rounded px-1 py-1 hover:bg-foreground/[0.035]"><input type={question.response_type === "multi_select" ? "checkbox" : "radio"} name={question.question_id} checked={checked} onChange={() => set_answers((previous) => {
            if (question.response_type !== "multi_select") return { ...previous, [question.question_id]: option.value };
            const selected = Array.isArray(previous[question.question_id]) ? previous[question.question_id] as string[] : [];
            return { ...previous, [question.question_id]: checked ? selected.filter((value) => value !== option.value) : [...selected, option.value] };
          })} /><span><span className="block">{option.label}</span>{option.description ? <span className="block text-[0.6875rem] text-muted-foreground">{option.description}</span> : null}</span></label>;
        })}
      </fieldset>)}
    </div>
    {pending ? <div className="mt-2 flex justify-end"><Button type="submit" variant="primary" disabled={submitting}>{submitting ? "提交中…" : "提交回答"}</Button></div> : <div className="mt-2 text-muted-foreground">已回答</div>}
  </form>;
}

/** Tool part 的紧凑活动视图。 */
function ToolPart({ part }: { /** Tool part。 */ part: Extract<SessionAssistantMessagePart, { type: "tool" }> }) {
  const running = part.state === "input-streaming" || part.state === "ready" || part.state === "running";
  return <details className={cn("activity-tool-row", running ? "is-running" : part.state === "failed" ? "is-failed" : "is-complete")}>
    <summary className="activity-tool-summary"><span className="activity-tool-main"><TbTool className="activity-tool-icon" aria-hidden /><span className="activity-tool-state">{tool_state_label(part.state)}</span><span className="activity-tool-name">{part.title || part.tool_name}</span><TbChevronRight className="activity-tool-chevron" aria-hidden /></span></summary>
    {(part.input ?? part.input_text) ? <pre className="activity-tool-payload">{format_tool_value(part.input ?? part.input_text)}</pre> : null}
    {part.output !== undefined ? <pre className="activity-tool-payload">{format_tool_value(part.output)}</pre> : null}
    {part.error ? <div className="mt-1 text-destructive">{part.error}</div> : null}
  </details>;
}

/** 统一提供与 Duobox Response 完全一致的 Streamdown 根类。 */
function ChatMarkdown({ text, mode, class_name }: { /** Markdown 原文。 */ text: string; /** Streamdown 渲染模式。 */ mode: "static" | "streaming"; /** 业务附加类名。 */ class_name?: string }) {
  return <Streamdown className={cn("chat-markdown size-full [&>*:first-child]:mt-0 [&>*:last-child]:mb-0 [&>p]:[&>br]:h-0 [&>br]:h-0 [&>hr]:hidden", class_name)} mode={mode}>{text}</Streamdown>;
}

/** 运行活动提示。 */
function ActivityIndicator({ status, compact = false }: { /** 运行阶段。 */ status?: DesktopChatRuntime["status"]; /** 是否嵌入消息。 */ compact?: boolean }) {
  return <div className={cn("assistant-message-menu-bar flex items-center pl-1", compact ? "h-6 min-h-6" : "px-1 py-2")}><span className="activity-tool-main h-5"><span className="thinking-dots-icon" aria-hidden>{Array.from({ length: 6 }, (_, index) => <span key={index} className="thinking-dot" />)}</span><span className="thinking-status-label">{status === "submitted" ? "正在提交" : status === "waiting_input" ? "等待输入" : "正在思考"}</span></span></div>;
}

/** 判断当前已有 streaming assistant。 */
function has_streaming_assistant(messages: SessionMessage[]): boolean {
  return messages.some((message) => message.type === "assistant" && message.status === "streaming");
}

/** 格式化 Tool 输入输出。 */
function format_tool_value(value: unknown): string {
  return typeof value === "string" ? value : JSON.stringify(value, null, 2);
}

/** Tool 生命周期的用户可见标签。 */
function tool_state_label(state: Extract<SessionAssistantMessagePart, { type: "tool" }>["state"]): string {
  if (state === "completed") return "已完成";
  if (state === "failed") return "失败";
  if (state === "waiting-user") return "等待确认";
  return "执行中";
}
