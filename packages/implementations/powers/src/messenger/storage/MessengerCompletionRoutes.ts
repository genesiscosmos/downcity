/**
 * Messenger 每轮完成输出的持久化来源关联。
 * 多次入站可能合并进同一 Turn；后续委派结果沿调用 Turn 继承来源，不取会话最新消息。
 */
import type { DatabaseSync } from "node:sqlite";

/** 与 MessengerStore 共享同一连接和事务，不另建数据库事实源。 */
export class MessengerCompletionRoutes {
  constructor(private readonly database: DatabaseSync) {
    database.exec(`
      CREATE TABLE IF NOT EXISTS messenger_completion_routes (
        agent_id TEXT NOT NULL,
        session_id TEXT NOT NULL,
        turn_id TEXT NOT NULL,
        inbound_ids TEXT NOT NULL CHECK (json_valid(inbound_ids)),
        PRIMARY KEY (agent_id, session_id, turn_id)
      );
    `);
  }

  /** 读取某一调用轮次的原始入站引用；不存在表示路由尚未提交。 */
  get(agent_id: string, session_id: string, turn_id: string): string[] | null {
    const row = this.database.prepare(`
      SELECT inbound_ids FROM messenger_completion_routes
      WHERE agent_id = ? AND session_id = ? AND turn_id = ?
    `).get(agent_id, session_id, turn_id);
    return row ? JSON.parse(String(row.inbound_ids)) as string[] : null;
  }

  /** 随 Account 一并删除其路由记录；调用方在删除 Conversation 前纳入同一事务。 */
  delete_account(account_id: string): void {
    this.database.prepare(`
      DELETE FROM messenger_completion_routes AS route WHERE EXISTS (
        SELECT 1 FROM messenger_conversations AS conversation
        WHERE conversation.agent_id = route.agent_id AND conversation.session_id = route.session_id
          AND conversation.account_id = ?
      )
    `).run(account_id);
  }

  /** 按 Turn 身份幂等提交，保存全部来源，回复目的地由消费侧去重。 */
  save(agent_id: string, session_id: string, turn_id: string, inbound_ids: readonly string[]): void {
    this.database.prepare(`
      INSERT INTO messenger_completion_routes (agent_id, session_id, turn_id, inbound_ids)
      VALUES (?, ?, ?, ?) ON CONFLICT (agent_id, session_id, turn_id)
      DO UPDATE SET inbound_ids = excluded.inbound_ids
    `).run(agent_id, session_id, turn_id, JSON.stringify([...new Set(inbound_ids)]));
  }
}
