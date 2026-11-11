/**
 * 启动时发现已接收但未收口的后台续轮。
 * 消息是接收事实源；只恢复后台续轮的终态，不自动重放模型或命令，也不新增投递队列。
 */
import type { SessionMessage } from "@downcity/type";
import { latest_session_input, session_input_facts } from "@/session/loop/SessionInputFacts.js";
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
          let latest: SessionMessage | undefined;
          for (;;) {
            const messages = await view.messages({ limit: 100, ...(before_sequence === undefined ? {} : { before_sequence }) });
            latest ??= latest_session_input(messages.items)?.message;
            if (latest?.origin) break;
            // Tool inbox 可以没有 meta；只向前翻到该 Turn 最近的可信输入，不加载整个会话。
            const turn_id = latest?.turn_id;
            const owner = turn_id && session_input_facts(messages.items).reverse().find((fact) =>
              !fact.message.origin && fact.message.turn_id === turn_id && fact.meta?.from);
            const actor = owner && owner.meta?.from;
            if (actor) {
              if (actor.kind === "runtime" && actor.namespace === "session_background") {
                await (await restore(entry.session_id, category)).status();
              }
              break;
            }
            if (!messages.has_more || !messages.next_before_sequence) break;
            before_sequence = messages.next_before_sequence;
          }
        } catch (error) { report_error(error); }
      }
      cursor = page.next_cursor;
    } while (cursor);
  }
}
