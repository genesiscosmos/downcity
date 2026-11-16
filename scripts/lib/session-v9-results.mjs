/**
 * 工具结果引用的离线版本转换。逐引用验证 canonical 快照摘要，结构化 lookup 页递归转换，
 * 受影响的上层引用重新绑定摘要与游标；循环、缺失和失配均阻塞，普通文本不参与替换。
 */
import path from "node:path";
import { fail } from "./session-v7-database.mjs";
import { open_source } from "./session-v9-database.mjs";
import { rewrite_disclosure, rewrite_result_reference } from "./session-v9-identities.mjs";
import { interrupted_messages } from "./session-v9-recovery-messages.mjs";

/** 连接和缓存由一轮预检/暂存明确拥有，调用方必须在 finally 中 close。 */
export function create_result_rewriter(context, runtime) {
  const databases = new Map(); const recovered = new Map(); const cached = new Map(); const active = new Set();
  const identities = new Map(context.agents.flatMap(agent => agent.identities.map(row => [row.session_id, row])));
  const source_database = agent_id => {
    let database = databases.get(agent_id);
    if (!database) { database = open_source(path.join(context.root_path, "agents", agent_id, "sessions.db")); databases.set(agent_id, database); }
    return database;
  };
  const rewrite = (reference, agent_id, resolve) => {
    const key = JSON.stringify([agent_id, reference]);
    if (cached.has(key)) return cached.get(key);
    if (active.has(key)) fail("cyclic_result_reference");
    if (active.size >= 64 || cached.size >= 200_000) fail("result_reference_budget_exceeded");
    // 先使用严格语法和身份映射校验，再读取来源；不能由引用字符串控制路径。
    const mapped = rewrite_result_reference(reference, agent_id, (owner_id, session_id, category, storage_id) => {
      try { return resolve(owner_id, session_id, category, storage_id); }
      catch (error) {
        if (error.migration_code !== "ambiguous_session_reference") throw error;
        // rewrite_result_reference 已验证协议；只以 canonical 消息、Part 和摘要证明原记录。
        const location = JSON.parse(Buffer.from(reference.slice(6), "base64url").toString());
        const database = source_database(owner_id);
        const part = database.prepare(`SELECT part.content FROM message_parts AS part JOIN messages AS message
          ON message.session_key=part.session_key AND message.message_id=part.message_id
          WHERE part.session_key=? AND message.message_id=? AND message.sequence=? AND part.part_id=? AND part.type='tool'`);
        const matches = [...identities.values()].filter(identity => {
          if (identity.agent_id !== owner_id || identity.source_session_id !== session_id
            || (category && identity.category !== category) || (storage_id && identity.source_storage_id !== storage_id)) return false;
          const row = part.get(identity.session_key, location.message_id, location.message_sequence, location.part_id);
          return row && runtime.result_digest(runtime.tool_result_value(JSON.parse(row.content))) === location.digest;
        });
        if (matches.length !== 1) throw error;
        return matches[0].session_id;
      }
    });
    const location = JSON.parse(Buffer.from(mapped.slice(6), "base64url").toString());
    const identity = identities.get(location.session_id);
    if (!identity || identity.agent_id !== agent_id) fail("result_reference_owner_mismatch");
    const database = source_database(agent_id);
    const row = database.prepare(`SELECT part.content FROM message_parts AS part JOIN messages AS message
      ON message.session_key=part.session_key AND message.message_id=part.message_id
      WHERE part.session_key=? AND part.message_id=? AND part.part_id=? AND part.type='tool' AND message.sequence=?`)
      .get(identity.session_key, location.message_id, location.part_id, location.message_sequence);
    if (!row) fail("result_reference_source_missing");
    const content = JSON.parse(row.content);
    if (runtime.result_digest(runtime.tool_result_value(content)) !== location.digest) fail("result_reference_digest_mismatch");
    active.add(key);
    try {
      // 先核验未修改来源，再以与 canonical 转换相同的中断结果计算新摘要。
      if (context.recovery && !recovered.has(agent_id)) recovered.set(agent_id,
        interrupted_messages(database, context.agents.find(agent => agent.agent_id === agent_id), context.recovery));
      const changed = recovered.get(agent_id)?.get(JSON.stringify([identity.session_key, location.message_id]))?.changed.get(location.part_id);
      const target_content = changed ? JSON.parse(changed.content) : content;
      const next = { ...target_content,
        ...(target_content.output !== undefined ? { output: rewrite_disclosure(target_content.output, agent_id, resolve, rewrite) } : {}) };
      const target = `res_2_${Buffer.from(JSON.stringify({ ...location, digest: runtime.result_digest(runtime.tool_result_value(next)) })).toString("base64url")}`;
      cached.set(key, target); return target;
    } finally { active.delete(key); }
  };
  const assert_fork = (message, agent_id) => {
    if (Boolean(message.origin_session_id) !== Boolean(message.origin_message_id)
      || ((message.origin_turn_id || message.origin_storage_id) && !message.origin_session_id)) fail("incomplete_fork_origin");
    if (!message.origin_session_id) return;
    const target_id = context.resolve(agent_id, message.origin_session_id, undefined, message.origin_storage_id);
    const identity = identities.get(target_id);
    const original = source_database(agent_id).prepare("SELECT turn_id FROM messages WHERE session_key=? AND message_id=?")
      .get(identity.session_key, message.origin_message_id);
    if (!original || (message.origin_turn_id && message.origin_turn_id !== original.turn_id)) fail("fork_source_message_missing_or_changed");
  };
  return { rewrite, assert_fork, close: () => { for (const database of databases.values()) database.close(); databases.clear(); recovered.clear(); cached.clear(); } };
}
