/**
 * Duobox Renderer 风格的 City Agent Chat 视图。
 *
 * Chat runtime 的生命周期与 Agent Session 一致；SSE 只负责通知 canonical
 * Session 已变化，消息内容仍从 City BFF 读取，避免在前端形成第二份事实源。
 */

import { useEffect, useMemo, useState } from "react";
import { ChatPanel, create_chat_runtime, type DowncityChatThread } from "@downcity/ui";
import type { CityWebSession } from "../../types/city-web";
import {
  create_city_session,
  execute_city_session,
  read_city_session_messages,
  respond_city_session_interaction,
  stop_city_session,
  subscribe_city_session,
} from "../../lib/city-web-api";

interface CityChatViewProps {
  /** 当前全局 Agent。 */
  agent_id: string;
  /** 当前 Session。 */
  session_id: string;
  /** Session 列表。 */
  sessions: CityWebSession[];
  /** 切换 Session。 */
  on_session_select: (session_id: string) => void;
  /** Session 创建完成后的回调。 */
  on_session_created: (session_id: string) => void;
}

export function CityChatView(props: CityChatViewProps) {
  const [error, set_error] = useState<string | null>(null);
  const runtime = useMemo(() => create_chat_runtime({
    submit_message: async (input) => {
      set_error(null);
      await execute_city_session(props.agent_id, props.session_id, input.text);
    },
    stop_generation: async () => {
      await stop_city_session(props.agent_id, props.session_id);
    },
    respond_interaction: async (interaction_id, response) => {
      await respond_city_session_interaction(props.agent_id, props.session_id, interaction_id, response);
    },
  }), [props.agent_id, props.session_id]);

  useEffect(() => {
    let disposed = false;
    const refresh_messages = async () => {
      const records = await read_city_session_messages(props.agent_id, props.session_id);
      if (disposed) return;
      for (const record of records) runtime.append_message(record);
    };
    runtime.set_status("submitted");
    void refresh_messages().then(() => runtime.set_status("ready")).catch((reason: unknown) => {
      if (!disposed) {
        set_error(String(reason));
        runtime.set_status("error");
      }
    });
    const unsubscribe = subscribe_city_session(props.agent_id, props.session_id, (mutation) => {
      if (disposed) return;
      const mutation_type = String(mutation.type ?? "");
      runtime.set_status(mutation_type === "finish" ? "ready" : "streaming");
      void refresh_messages().catch((reason: unknown) => set_error(String(reason)));
      if (mutation_type === "finish") {
        const queued_input = runtime.dequeue();
        if (queued_input) void runtime.submit(queued_input);
      }
    }, () => {
      if (!disposed) set_error("Session event stream disconnected");
    });
    return () => {
      disposed = true;
      unsubscribe();
    };
  }, [props.agent_id, props.session_id, runtime]);

  const threads = useMemo<DowncityChatThread[]>(() => props.sessions.map((session) => ({
    id: session.session_id,
    title: session.title || session.preview_text || session.session_id,
    updated_at: session.updated_at,
  })), [props.sessions]);
  const thread = threads.find((item) => item.id === props.session_id) ?? {
    id: props.session_id,
    title: props.session_id,
  };
  const create_session = async () => {
    const session_id = await create_city_session(props.agent_id);
    props.on_session_created(session_id);
  };

  return <section className="city-chat-view">
    {error ? <div className="city-chat-error">{error}</div> : null}
    <ChatPanel
      className="city-chat-panel"
      runtime={runtime}
      thread={thread}
      threads={threads}
      title={thread.title}
      empty_title="开始一段新对话"
      empty_description={`正在与 City Agent ${props.agent_id} 对话。`}
      input_placeholder="输入消息…"
      model_options={[{ id: "default", label: "Agent model" }]}
      on_create_thread={() => create_session()}
      on_select_thread={props.on_session_select}
      on_respond_interaction={(interaction_id, response) => runtime.respond_interaction(interaction_id, response)}
    />
  </section>;
}
