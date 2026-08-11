/** 使用 Duobox ChatCore 的 DOM、间距和消息排版实现 Downcity Session Chat。 */

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { TbArrowUp, TbChecklist, TbCpu, TbLoader2, TbMessageCircle, TbPlus, TbRoute, TbSearch, TbSquare, TbWriting } from "react-icons/tb";
import { Button } from "@/components/ui/button";
import { MainViewBody, MainViewLayout } from "@/layouts/MainViewLayout";
import type { DesktopAgentSummary, DesktopChatMessage, DesktopSessionSummary } from "@common/types/DesktopApi";

/** Session Chat 主视图属性。 */
interface SessionViewProps {
  /** Session 所属 Agent。 */
  agent: DesktopAgentSummary;
  /** 当前 Session 摘要。 */
  session: DesktopSessionSummary;
  /** 当前 Session 的可见消息。 */
  messages: DesktopChatMessage[];
  /** 当前 Session 是否正在等待 Agent 返回。 */
  sending: boolean;
  /** 发送一条消息。 */
  send_message(text: string): Promise<void>;
}

/** Duobox 空会话的预设提示。 */
const EMPTY_PROMPTS = [
  { title: "写作与创作", description: "帮助我完善一段文字或构思", icon: TbWriting, prompt: "帮我完善一段文字" },
  { title: "研究与分析", description: "整理信息并提炼关键结论", icon: TbSearch, prompt: "帮我分析这个问题" },
  { title: "规划项目", description: "把目标拆解成可执行的步骤", icon: TbRoute, prompt: "帮我规划一个执行方案" },
  { title: "团队协作", description: "一起梳理任务、方案和下一步", icon: TbChecklist, prompt: "帮我梳理下一步任务" },
];

/** 格式化消息时间，与 Duobox Chat 的短时间格式保持一致。 */
function format_message_time(timestamp: number): string {
  return timestamp ? new Intl.DateTimeFormat("zh-CN", { hour: "2-digit", minute: "2-digit" }).format(timestamp) : "";
}

/** Session 对话主视图。 */
export function SessionView({ agent, session, messages, sending, send_message }: SessionViewProps) {
  const [input, set_input] = useState("");
  const bottom_ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    bottom_ref.current?.scrollIntoView({ behavior: "instant" });
  }, [messages, sending]);

  const submit_message = async () => {
    const text = input.trim();
    if (!text || sending) return;
    set_input("");
    await send_message(text);
  };

  const handle_input_key_down = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
    event.preventDefault();
    void submit_message();
  };

  return <MainViewLayout>
    <header className="header-drag-region flex h-10 w-full flex-none items-center gap-2 px-2">
      <Button size="icon" title="Session"><TbMessageCircle /></Button>
      <div className="min-w-0 flex-1 truncate text-xs font-medium text-foreground/80">{session.title || "新会话"}</div>
      <div className="header-drag-region min-w-0 flex-1" />
      <span className="max-w-44 truncate text-[0.625rem] text-muted-foreground">{agent.agent_id}</span>
    </header>
    <MainViewBody>
      <div className="relative flex min-h-0 flex-1 flex-col bg-transparent">
        <div className="relative min-h-0 flex-1 overflow-y-auto" role="log">
          <div className="mx-auto flex min-h-full w-full max-w-[840px] flex-col gap-0 p-2">
            {messages.length === 0 ? <EmptyPrompts on_select={(prompt) => set_input(prompt)} /> : null}
            {messages.map((message) => <ChatMessage key={message.message_id} message={message} agent_id={agent.agent_id} />)}
            {sending ? <div className="flex w-full items-end justify-end gap-2 py-2"><div className="w-full px-1 pt-0.5 text-xs text-muted-foreground"><span className="inline-flex items-center gap-1"><TbLoader2 className="size-3 animate-spin" />正在思考…</span></div></div> : null}
            <div ref={bottom_ref} />
          </div>
        </div>

        <div className="mx-auto m-2 w-[calc(100%-1rem)] max-w-[840px] flex-none rounded-2xl bg-muted-foreground/10">
          <div className="w-full p-1">
            <div className="w-full min-h-20 max-h-60 overflow-hidden p-1" aria-busy={sending}>
              <textarea className="chat-input-editor" rows={2} value={input} disabled={sending} placeholder={sending ? "排队发送下一条消息…" : "向 Agent 发送消息…"} onChange={(event) => set_input(event.target.value)} onKeyDown={handle_input_key_down} />
              <div className="mt-2 flex items-center justify-between">
                <div className="flex items-center gap-1">
                  <Button size="icon" className="rounded-full" title="添加"><TbPlus className="size-4" /></Button>
                  <Button className="rounded-full text-muted-foreground" title="当前模型"><TbCpu className="size-3.5" /><span className="max-w-36 truncate">{agent.model_id || "模型"}</span></Button>
                </div>
                <Button type="button" onClick={() => void submit_message()} disabled={sending || !input.trim()} size="icon" variant="primary" className="rounded-full" aria-label="发送" title="发送">
                  {sending ? <TbSquare className="size-4 stroke-3" /> : <TbArrowUp className="size-4 stroke-3" />}
                </Button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </MainViewBody>
  </MainViewLayout>;
}

/** Duobox ChatEmptyPrompts 的精确布局。 */
function EmptyPrompts({ on_select }: { /** 将预设提示放入输入框。 */ on_select(prompt: string): void }) {
  return <div className="flex min-h-[50vh] flex-col items-center justify-center gap-6 px-4">
    <div className="flex w-full max-w-80 flex-col items-center gap-3">
      <p className="text-center text-sm text-muted-foreground">开始新的对话</p>
      <div className="flex w-full flex-col gap-1">
        {EMPTY_PROMPTS.map(({ title, description, icon: Icon, prompt }) => <Button key={title} size="full" className="h-auto min-h-12 items-start gap-2 rounded-md px-2.5 py-2 text-left whitespace-normal text-foreground/75 hover:bg-foreground/[0.06] hover:text-foreground" onClick={() => on_select(prompt)}>
          <Icon className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
          <span className="min-w-0 flex-1"><span className="block text-[0.6875rem] font-medium leading-4">{title}</span><span className="mt-0.5 line-clamp-2 block text-[0.625rem] font-normal leading-3.5 text-muted-foreground">{description}</span></span>
        </Button>)}
      </div>
    </div>
  </div>;
}

/** Duobox MessageFrame 的简化消息投影。 */
function ChatMessage({ message, agent_id }: { /** 当前消息。 */ message: DesktopChatMessage; /** Agent 展示名称。 */ agent_id: string }) {
  if (message.role === "system" || message.role === "error") return <div className="flex justify-center py-2 text-xs text-muted-foreground"><span className={message.role === "error" ? "text-destructive" : ""}>{message.text}</span></div>;
  const user_message = message.role === "user";
  return <div className={`group flex w-full items-end justify-end gap-2 py-2 ${user_message ? "is-user" : "is-assistant flex-row-reverse justify-end"}`}>
    <div className={user_message ? "user-message-stack flex w-full max-w-[min(80%,42rem)] min-w-0 flex-col items-end gap-0.5" : "flex w-full flex-col gap-2 overflow-hidden rounded-lg p-1 text-sm text-foreground"}>
      <div className="mb-0.5 flex items-center gap-1 text-[0.625rem] text-muted-foreground/60"><span>{user_message ? "你" : agent_id}</span><span>{format_message_time(message.created_at)}</span></div>
      <div className={user_message ? "w-fit max-w-full rounded-2xl rounded-tr-none bg-muted-foreground/10 px-3 py-2 text-foreground" : "w-full whitespace-pre-wrap break-words text-[0.8125rem] leading-[1.5]"}>{message.text || (message.pending ? "正在思考…" : "")}</div>
    </div>
  </div>;
}
