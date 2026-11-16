/**
 * 将离线快照中的未结束消息收口为明确中断。只修改新目标数据库，保留已有正文、
 * 已完成工具和所有原始记录；未执行工具不会重放，也不能被标记为成功。
 */
import { digest, fail } from "./session-v7-database.mjs";

const interrupted_message = "Session execution was interrupted before offline migration; no tool was replayed.";

/** 为每条精确消息生成确定性的收口快照和审计摘要。 */
export function interrupted_messages(source, agent, recovery) {
  const updates = new Map();
  const pending = source.prepare("SELECT * FROM messages WHERE state='streaming' ORDER BY session_key,sequence").all();
  if (pending.length && !recovery) fail("unfinished_session_turn");
  const select_parts = source.prepare("SELECT * FROM message_parts WHERE session_key=? AND message_id=? ORDER BY sequence");
  for (const message of pending) {
    const parts = select_parts.all(message.session_key, message.message_id);
    const changed = new Map();
    const interrupted_at = Math.max(message.updated_at, ...parts.map(part => part.updated_at));
    for (const part of parts) {
      const content = JSON.parse(part.content); let next = content;
      if (["text", "reasoning"].includes(part.type)) next = { ...content, state: "done" };
      else if (part.type === "action" && content.state === "running") next = { ...content, state: "failed" };
      else if (part.type === "tool") {
        const interactions = content.interactions?.map(interaction => interaction.status === "pending"
          ? { ...interaction, status: "cancelled", cancel_reason: "runtime_interrupted", resolved_at: interrupted_at } : interaction);
        next = { ...content, ...(interactions ? { interactions } : {}),
          ...(!["completed", "failed"].includes(content.state) ? { state: "failed", error: interrupted_message } : {}) };
      }
      if (digest(content) !== digest(next)) {
        if (part.sequence <= message.stable_part_sequence) fail("recovery_cannot_change_stable_part");
        changed.set(part.part_id, { ...part, content: JSON.stringify(next), updated_at: interrupted_at });
      }
    }
    const sequence = (parts.at(-1)?.sequence ?? 0) + 1;
    const part_id = `migration-interrupted:${digest([message.session_key, message.message_id]).slice(0, 32)}`;
    if (parts.some(part => part.part_id === part_id)) fail("recovery_error_part_conflict");
    const diagnostic = { session_key: message.session_key, message_id: message.message_id, part_id, sequence,
      step_id: null, type: "error", content: JSON.stringify({ type: "error", part_id, sequence,
        scope: "turn", code: "turn_stopped", message: interrupted_message, recoverable: true }), created_at: interrupted_at, updated_at: interrupted_at };
    const next_message = { ...message, state: "done", revision: message.revision + 1, stable_part_sequence: sequence, updated_at: interrupted_at };
    recovery.record("interrupt_message", agent.relative_path, { message, parts }, {
      session_key: message.session_key, message_id: message.message_id, changed_part_ids: [...changed.keys()], diagnostic_part_id: part_id,
    });
    updates.set(JSON.stringify([message.session_key, message.message_id]), { message: next_message, changed, diagnostic });
  }
  return updates;
}
