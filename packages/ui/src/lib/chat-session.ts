/** 连接既有 Session actor：先建立 ready 订阅，再合并快照；不复制 HTTP 协议或持有 Agent。 */
import type { SessionMessage, SessionMutation, SessionRuntimeSnapshot, SessionInteractionResponse } from "@downcity/type";
import type { DowncityChatConnection, DowncityChatSession } from "../types/chat-session";
import { DowncityChatRuntime } from "./chat-runtime";
import { apply_session_mutations, merge_session_snapshot } from "./session-mutation";
import { session_message_to_chat_message } from "./session-message";

/** 使用 RemoteAgent.sessions.get/create 返回的 Session 即可接入 ChatPanel；调用方负责 close。 */
export async function connect_chat_session(session: DowncityChatSession): Promise<DowncityChatConnection> {
  let closed = false;
  let ready = false;
  let messages: SessionMessage[] = [];
  let buffered: SessionMutation[] = [];
  let scheduled = false;
  let next_before_sequence: number | undefined;
  let has_more = false;
  let loading_earlier: Promise<boolean> | undefined;
  let snapshot: SessionRuntimeSnapshot = { state: "idle", live_execution: false };
  let unsubscribe: (() => void) | undefined;
  let connection_error: Error | undefined;
  let runtime_generation = 0;
  let status_request = 0;

  const assert_open = () => {
    if (closed) throw new Error("Chat connection is closed");
    if (connection_error) throw connection_error;
  };
  /** 请求开始之后收到更新运行态时，迟到快照不能回滚新 Turn。 */
  const refresh_status = async () => {
    const generation = runtime_generation;
    const request = ++status_request;
    const next = await session.status();
    if (generation === runtime_generation && request === status_request) sync_runtime(next);
  };
  const runtime = new DowncityChatRuntime({
    session_id: session.id,
    submit_message: async input => {
      assert_open();
      const query = input.parts ?? (input.attachments.length ? [
        ...(input.text ? [{ type: "text" as const, text: input.text }] : []),
        ...input.attachments.map(file => {
          if (!file.url) throw new Error(`Attachment ${file.name} requires a URL`);
          return { type: "file" as const, url: file.url, filename: file.name, media_type: file.type ?? "application/octet-stream" };
        }),
      ] : input.text);
      await session.prompt({ query });
      if (!closed) await refresh_status();
    },
    stop_generation: async () => {
      assert_open();
      // 停止必须绑定点击时的 Turn；不把未知的执行身份转换为任意停止。
      if (!snapshot.active_turn_id) throw new Error("No active Turn to stop");
      const message = [...messages].reverse().find(message => message.role === "agent" && message.turn_id === snapshot.active_turn_id);
      const checkpoint = message ? { message_id: message.message_id, revision: message.revision } : undefined;
      await session.stop(snapshot.active_turn_id, checkpoint);
      if (!closed) await refresh_status();
    },
    respond_interaction: async (interaction_id, response) => {
      assert_open();
      await session.respond({ interaction_id, response: response as SessionInteractionResponse });
    },
    retry_message: async message_id => {
      assert_open();
      const retry = snapshot.model_retry;
      if (!retry || retry.message_id !== message_id || snapshot.live_execution) throw new Error("This failure can no longer be retried");
      const result = await session.retry_model_step(retry);
      if (!closed) await refresh_status();
      if (!result.accepted) throw new Error(result.reason || "Retry was not accepted");
    },
  });

  /** 网络中断不自动重发 prompt；由宿主重新建立连接并读取权威状态。 */
  const fail = (error: unknown) => {
    if (closed) return;
    runtime.set_status("error");
    runtime.set_connection_state(error instanceof Error ? error.message : String(error));
  };
  const publish_messages = () => {
    runtime.replace_messages(messages.flatMap(message => {
      const projected = session_message_to_chat_message(message as unknown as Record<string, unknown>);
      return projected ? [projected] : [];
    }));
  };
  const sync_runtime = (next: SessionRuntimeSnapshot) => {
    if (closed || connection_error) return;
    snapshot = next;
    runtime.set_connection_state(undefined, next.model_retry?.message_id);
    runtime.set_status(next.state === "failed" ? "error" : next.live_execution ? "streaming" : "ready");
  };
  const flush = () => {
    scheduled = false;
    if (!ready || closed) return;
    const mutations = buffered;
    buffered = [];
    messages = apply_session_mutations(messages, mutations);
    publish_messages();
    for (const mutation of mutations) {
      if (mutation.variant === "session" && mutation.type === "runtime") sync_runtime(mutation);
      // 生命周期事件之后再读运行态，等待中的输入与可重试状态由 Session 决定。
      if (mutation.variant === "turn" && mutation.type === "finish") void refresh_status().catch(fail);
    }
  };
  const receive = (mutation: SessionMutation) => {
    if (closed || mutation.session_id !== session.id) return;
    if (mutation.variant === "session" && mutation.type === "runtime") runtime_generation += 1;
    buffered.push(mutation);
    if (ready && !scheduled) { scheduled = true; queueMicrotask(flush); }
  };
  try {
    unsubscribe = await session.watch(receive, error => {
      connection_error = error;
      fail(error);
    });
    assert_open();
    const [page, status] = await Promise.all([session.messages(), session.status()]);
    messages = page.items;
    has_more = page.has_more;
    next_before_sequence = page.next_before_sequence;
    ready = true;
    sync_runtime(status);
    flush();
  } catch (error) {
    closed = true;
    unsubscribe?.();
    throw error;
  }
  return {
    runtime,
    close: () => { if (closed) return; closed = true; buffered = []; unsubscribe?.(); runtime.close(); },
    load_earlier: () => {
      assert_open();
      if (loading_earlier) return loading_earlier;
      if (!has_more) return Promise.resolve(false);
      loading_earlier = (async () => {
        const page = await session.messages({ before_sequence: next_before_sequence });
        assert_open();
        messages = merge_session_snapshot(messages, page.items);
        has_more = page.has_more; next_before_sequence = page.next_before_sequence;
        publish_messages();
        return has_more;
      })().finally(() => { loading_earlier = undefined; });
      return loading_earlier;
    },
  };
}
