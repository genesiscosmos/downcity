/**
 * Agent React 对话页面。
 *
 * 页面只维护展示与提交状态；对话历史和多轮上下文始终以服务端 Session 为准。
 */

import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Textarea,
} from "@downcity/ui";
import type {
  ChatErrorResponse,
  ChatMessage,
  ChatResponse,
  SendChatMessageRequest,
} from "../../types/chat.js";

/** 读取 JSON 响应，并把服务端错误收敛成异常。 */
async function read_response(response: Response): Promise<ChatResponse> {
  const payload = await response.json() as ChatResponse | ChatErrorResponse;
  if (!response.ok || "error" in payload) {
    throw new Error("error" in payload ? payload.error : "请求失败");
  }
  return payload;
}

/** 单页 Agent 对话应用。 */
export function App() {
  const [messages, set_messages] = useState<ChatMessage[]>([]);
  const [content, set_content] = useState("");
  const [loading, set_loading] = useState(true);
  const [sending, set_sending] = useState(false);
  const [error, set_error] = useState<string>();
  const end_ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void load_messages();
  }, []);

  useEffect(() => {
    end_ref.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, sending]);

  /** 从服务端 Session 加载 canonical 对话历史。 */
  async function load_messages(): Promise<void> {
    try {
      set_loading(true);
      set_error(undefined);
      const response = await fetch("/api/chat");
      set_messages((await read_response(response)).messages);
    } catch (cause) {
      set_error(cause instanceof Error ? cause.message : "加载对话失败");
    } finally {
      set_loading(false);
    }
  }

  /** 提交一条用户消息，并用服务端完整快照刷新页面。 */
  async function send_message(event: FormEvent): Promise<void> {
    event.preventDefault();
    const next_content = content.trim();
    if (!next_content || sending) return;

    try {
      set_sending(true);
      set_error(undefined);
      set_content("");
      const body: SendChatMessageRequest = { content: next_content };
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      set_messages((await read_response(response)).messages);
    } catch (cause) {
      set_content(next_content);
      set_error(cause instanceof Error ? cause.message : "发送失败");
    } finally {
      set_sending(false);
    }
  }

  return (
    <main className="min-h-screen bg-[#f5f5f3] px-4 py-6 text-foreground sm:px-6 sm:py-10">
      <Card className="mx-auto h-[calc(100vh-3rem)] max-w-4xl border border-black/[0.06] bg-white/90 sm:h-[calc(100vh-5rem)]">
        <CardHeader className="border-b border-black/[0.06] pb-4">
          <div className="flex items-center gap-3">
            <div className="flex size-10 items-center justify-center rounded-2xl bg-[#171717] text-sm font-semibold text-white">
              DC
            </div>
            <div>
              <CardTitle>Downcity Agent</CardTitle>
              <CardDescription>与你的项目进行连续对话</CardDescription>
            </div>
          </div>
        </CardHeader>

        <CardContent className="flex min-h-0 flex-1 flex-col p-0">
          <section className="flex-1 overflow-y-auto px-5 py-6 sm:px-8" aria-live="polite">
            {loading ? (
              <p className="text-center text-sm text-muted-foreground">正在加载对话…</p>
            ) : messages.length === 0 ? (
              <div className="mx-auto flex h-full max-w-md flex-col items-center justify-center text-center">
                <p className="text-lg font-medium tracking-[-0.02em]">从一个问题开始</p>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">
                  例如：介绍项目结构，或者帮我定位一个实现。
                </p>
              </div>
            ) : (
              <div className="space-y-5">
                {messages.map((message) => (
                  <article
                    key={message.id}
                    className={message.role === "user" ? "flex justify-end" : "flex justify-start"}
                  >
                    <div
                      className={[
                        "max-w-[85%] whitespace-pre-wrap rounded-2xl px-4 py-3 text-sm leading-6 sm:max-w-[75%]",
                        message.role === "user"
                          ? "rounded-br-md bg-[#171717] text-white"
                          : message.role === "error"
                            ? "rounded-bl-md bg-red-50 text-red-700"
                            : "rounded-bl-md bg-[#f1f1ef] text-[#242424]",
                      ].join(" ")}
                    >
                      {message.content}
                    </div>
                  </article>
                ))}
                {sending ? (
                  <div className="flex justify-start">
                    <div className="rounded-2xl rounded-bl-md bg-[#f1f1ef] px-4 py-3 text-sm text-muted-foreground">
                      Agent 正在思考…
                    </div>
                  </div>
                ) : null}
              </div>
            )}
            <div ref={end_ref} />
          </section>

          <form onSubmit={(event) => void send_message(event)} className="border-t border-black/[0.06] p-4 sm:p-5">
            {error ? <p className="mb-3 text-sm text-red-600">{error}</p> : null}
            <div className="flex items-end gap-3 rounded-2xl bg-[#f5f5f3] p-2">
              <Textarea
                value={content}
                onChange={(event) => set_content(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    event.currentTarget.form?.requestSubmit();
                  }
                }}
                placeholder="输入消息，Enter 发送"
                rows={1}
                disabled={sending}
                className="max-h-36 min-h-11 flex-1 resize-none border-0 bg-transparent shadow-none focus-visible:ring-0"
              />
              <Button
                type="submit"
                disabled={!content.trim() || sending}
                className="mb-0.5 bg-[#171717] px-4 text-white hover:bg-[#2b2b2b] hover:text-white"
              >
                发送
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}
