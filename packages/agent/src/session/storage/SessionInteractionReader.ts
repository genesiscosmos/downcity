/**
 * 原 Session Interaction 的只读查询与引用投影。
 *
 * 文件模式使用短生命周期只读连接，只查询 streaming Agent Message，绝不恢复执行器、
 * 初始化 schema 或加载完整历史。内存模式复用已有 Storage 的非终态查询。
 */
import { DatabaseSync } from "node:sqlite";
import type { SessionAgentInteraction, SessionMessage } from "@downcity/type";
import type { AgentInteraction } from "@/types/agent/AgentInteractions.js";
import { decode_session_message, type SessionMessageRow, type SessionMessagePartRow } from "./SessionStorageCodec.js";

/** 为原交互构造当前 Agent 内可验证的公开引用，返回独立快照。 */
export function project_agent_interaction(
  session_id: string,
  session_category: string,
  interaction: SessionAgentInteraction,
  can_respond = false,
): AgentInteraction {
  return {
    reference: {
      session_category,
      session_id,
      turn_id: interaction.request.turn_id,
      interaction_id: interaction.interaction_id,
    },
    interaction: structuredClone(interaction),
    can_respond,
  };
}

/** 只投影 canonical Tool 中真正 pending 的 Interaction。 */
export function collect_pending_interactions(
  messages: readonly SessionMessage[],
): SessionAgentInteraction[] {
  return messages.flatMap((message) => message.role === "agent"
    ? message.parts.flatMap((part) => part.type === "tool"
      ? (part.interactions ?? []).filter((interaction) => interaction.status === "pending")
      : []) : []);
}

/** 在一个只读事务内校验 Agent/分类身份，并查询尚未终结的 Tool 交互。 */
export function read_file_pending_interactions(
  database_path: string,
  agent_id: string,
  session_id: string,
  session_category: string,
): SessionAgentInteraction[] {
  const database = new DatabaseSync(database_path, { readOnly: true });
  try {
    database.exec("BEGIN");
    const identity = database.prepare(`
      SELECT agent_id, session_id, json_extract(origin, '$.category') AS category
      FROM session_state WHERE singleton_id = 1
    `).get();
    if (identity?.agent_id !== agent_id || identity.session_id !== session_id
      || identity.category !== session_category) {
      throw new Error("session_target_forbidden: Session is unavailable to this Agent");
    }
    const rows = database.prepare(`
      SELECT * FROM messages
      WHERE role = 'agent' AND state = 'streaming'
      ORDER BY sequence ASC
    `).all() as unknown as SessionMessageRow[];
    const parts = database.prepare(`
      SELECT * FROM message_parts WHERE message_id = ? AND type = 'tool'
      ORDER BY sequence ASC
    `);
    const messages = rows.map((row) => decode_session_message(row,
      parts.all(row.message_id) as unknown as SessionMessagePartRow[], session_id));
    return collect_pending_interactions(messages);
  } finally {
    database.close();
  }
}
