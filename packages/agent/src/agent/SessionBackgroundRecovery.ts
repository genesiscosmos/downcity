/**
 * 启动时发现已接收但未收口的后台续轮。
 * 消息是接收事实源；只恢复后台续轮的终态，不自动重放模型或命令，也不新增投递队列。
 */
import { read_session_message_meta } from "@/session/messages/SessionMessageMeta.js";
import type { SessionStore } from "@/types/store/SessionStore.js";
import type { AgentSession } from "@/types/agent/SessionActor.js";

/** 扫描持久化消息，仅为受信后台续轮恢复 Session，让其现有初始化逻辑收口中断。 */
export async function recover_background_sessions(
  store: SessionStore,
  restore: (session_id: string, category: string) => Promise<AgentSession>,
  report_error: (error: unknown) => void,
): Promise<void> {
  for (const category of ["chat", "work"]) {
    let cursor: string | undefined;
    do {
      const page = await store.list_sessions({ category, limit: 100, ...(cursor ? { cursor } : {}) }, new Set());
      for (const entry of page.items) {
        try {
          const view = await store.read_session(entry.session_id, category);
          let before_sequence: number | undefined;
          for (;;) {
            const messages = await view.messages({ limit: 20, include_internal: true, ...(before_sequence === undefined ? {} : { before_sequence }) });
            const latest = [...messages.items].reverse().find((message) => message.role === "user");
            if (latest) {
              const actor = read_session_message_meta(latest)?.from;
              if (!latest.origin && actor?.kind === "runtime" && actor.namespace === "session_background") {
                await (await restore(entry.session_id, category)).status();
              }
              break;
            }
            if (!messages.items.length) break;
            before_sequence = Math.min(...messages.items.map((message) => message.sequence));
          }
        } catch (error) { report_error(error); }
      }
      cursor = page.next_cursor;
    } while (cursor);
  }
}
