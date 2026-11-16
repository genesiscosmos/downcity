/**
 * 全根离线引用转换的领域适配器。只认识明确持久协议：Group、Task、Messenger、通知和完成日志。
 * 普通正文、Task prompt、Power 自定义路由及未知载荷保持原文；解析失败或目标歧义直接阻塞。
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire as create_require } from "node:module";
import { createHash as create_hash } from "node:crypto";
import { check_integrity, digest, fail } from "./session-v7-database.mjs";
import { exists, ordinary } from "./session-v8-files.mjs";
import { convert_part } from "./session-v9-conversion.mjs";
import { rewrite_meta, rewrite_origin } from "./session-v9-identities.mjs";
import { open_source } from "./session-v9-database.mjs";
import { audit_directory, is_unavailable_reference, recover_group_origin } from "./session-v9-recovery.mjs";

const { parse: parse_toml, stringify: stringify_toml } = create_require(new URL("../../packages/city/package.json", import.meta.url))("smol-toml");

/** 有界层级遍历且不跟随链接；不扫描 Workspace、附件或保留的旧分库。 */
export function entries(directory, directories = true) {
  if (!exists(directory)) return [];
  ordinary(directory, true);
  return fs.readdirSync(directory).sort().map(name => {
    const file_path = path.join(directory, name);
    const stat = fs.lstatSync(file_path);
    if (stat.isSymbolicLink()) fail("unsafe_storage_path");
    return { name, file_path, stat };
  }).filter(item => directories ? item.stat.isDirectory() : item.stat.isFile());
}

/** v8 的完成消息快照必须和 canonical 保持相同转换规则。 */
function rewrite_message(message, agent_id, context, owner) {
  const origin = message.origin;
  const output = { ...message,
    ...(message.session_id ? { session_id: context.resolve(agent_id, message.session_id, undefined,
      message.storage_id ?? (message.session_id === owner.source_session_id ? owner.source_storage_id : undefined)) } : {}),
    ...(origin ? { origin: { ...origin, session_id: context.resolve(agent_id, origin.session_id, undefined,
      origin.storage_id ?? (origin.session_id === owner.source_session_id ? owner.source_storage_id : undefined)) } } : {}),
    ...(message.meta ? { meta: rewrite_meta(message.meta, context.resolve) } : {}),
    parts: message.parts.map(part => convert_part(part, part.type, agent_id, context)),
  };
  delete output.storage_id;
  if (output.origin) delete output.origin.storage_id;
  return output;
}

/** 旧完成日志没有记录 UUID 时，只允许 canonical Turn 和全部消息共同唯一证明归属。 */
function completion_owner(value, agent_id, context) {
  const event = value.event;
  const agent = context.agents.find(item => item.agent_id === agent_id);
  let session_id;
  try { session_id = context.resolve(agent_id, event.session_id, value.origin.category, event.storage_id); }
  catch (error) {
    if (error.migration_code !== "ambiguous_session_reference" || !event.turn_id || !event.messages.length) throw error;
    const source = open_source(path.join(context.root_path, "agents", agent_id, "sessions.db"));
    try {
      const message = source.prepare("SELECT 1 FROM messages WHERE session_key=? AND message_id=? AND turn_id=?");
      const matches = agent.identities.filter(identity => identity.source_session_id === event.session_id
        && (!value.origin.category || identity.category === value.origin.category) && (!event.storage_id || identity.source_storage_id === event.storage_id)
        && event.messages.every(item => item.message_id && item.turn_id === event.turn_id
          && message.get(identity.session_key, item.message_id, event.turn_id)));
      if (matches.length !== 1) throw error;
      session_id = matches[0].session_id;
    } finally { source.close(); }
  }
  return agent.identities.find(identity => identity.session_id === session_id);
}

/** 只在受信结构里重写身份，不对历史文本做全文替换。 */
export function rewrite_completion(value, agent_id, context) {
  const owner = completion_owner(value, agent_id, context);
  const { session_id } = owner;
  const completion_id = `completion:${session_id}:${value.event.turn_id}`;
  if (value.event.completion_id !== `completion:${value.event.session_id}:${value.event.turn_id}`) fail("completion_identity_invalid");
  const event = { ...value.event, session_id, completion_id,
    messages: value.event.messages.map(message => rewrite_message(message, agent_id, context, owner)) };
  delete event.storage_id;
  return { ...value, event, origin: recover_group_origin(rewrite_origin(value.origin, agent_id, context.resolve), context.recovery) };
}

/** visitor 只接收正在处理的一个文件，避免所有完成日志正文长期留在内存。 */
export function visit_reference_files(context, visit, on_block) {
  const { root_path, agents, resolve } = context;
  const inspect = (file_path, operation) => {
    try { return operation(); }
    catch (error) { if (!on_block) throw error; on_block(error, path.relative(root_path, file_path)); }
  };
  const json_file = (file_path, transform, target_for = () => file_path, completed_ledger = false) => {
    return inspect(file_path, () => {
    if (!exists(file_path)) return;
    ordinary(file_path);
    const raw = fs.readFileSync(file_path, "utf8");
    const value = JSON.parse(raw); let next;
    try { next = transform(value); }
    catch (error) {
      if (!context.recovery || !completed_ledger || !is_unavailable_reference(error)) throw error;
      const completed = value.event ? value.state === "delivered" : ["delivered", "cancelled", "saved"].includes(value.delivery_state)
        && ["succeeded", "completed", "failed", "stopped"].includes(value.execution_state);
      if (!completed) fail("pending_ledger_requires_review");
      context.recovery.quarantine(file_path, raw, error.migration_code ?? error.message, visit); return;
    }
    const text = digest(value) === digest(next) ? raw : `${JSON.stringify(next)}\n`;
    // 无需重写的已知资源也进入指纹范围，恢复不能遗漏后续新增的引用或偏好写入。
    visit(file_path, target_for(next), raw, text);
    });
  };
  for (const agent of agents) {
    const agent_path = path.join(root_path, "agents", agent.agent_id);
    for (const record of entries(path.join(agent_path, "session-files"))) {
      const identity = agent.identities.find(item => item.source_storage_id === record.name);
      if (!identity) { inspect(record.file_path, () => fail("orphan_attachment_directory")); continue; }
      const ownership_path = path.join(record.file_path, ".owned-attachments.json");
      json_file(ownership_path, value => {
        if (value.format_version !== 1 || value.agent_id !== agent.agent_id || value.storage_id !== record.name
          || Object.keys(value).sort().join(",") !== "agent_id,files,format_version,storage_id" || !Array.isArray(value.files)) fail("attachment_ownership_invalid");
        const { storage_id, ...rest } = value;
        return { ...rest, format_version: 2, session_id: identity.session_id };
      });
    }
    for (const file of entries(path.join(agent_path, "completions"), false)) {
      if (!file.name.endsWith(".json")) continue;
      json_file(file.file_path, value => {
        if (file.name !== `${create_hash("sha256").update(value.event.completion_id).digest("hex")}.json`) fail("completion_filename_mismatch");
        return rewrite_completion(value, agent.agent_id, context);
      }, value =>
        path.join(path.dirname(file.file_path), `${create_hash("sha256").update(value.event.completion_id).digest("hex")}.json`), true);
    }
    for (const file of entries(path.join(agent_path, "delegations"), false)) {
      if (!/^[a-f0-9]{64}\.json$/u.test(file.name)) continue;
      json_file(file.file_path, value => {
        if (value.delegation_id !== file.name.slice(0, -5)) fail("delegation_identity_invalid");
        if (value.delivery_state === "pending") fail("pending_delegation_delivery");
        return { ...value, work_session_id: resolve(agent.agent_id, value.work_session_id, "work"), caller: { ...value.caller,
          session_id: resolve(value.caller.agent_id, value.caller.session_id, value.caller.origin.category),
          origin: recover_group_origin(rewrite_origin(value.caller.origin, value.caller.agent_id, resolve), context.recovery) } };
      }, undefined, true);
    }
    const closed_entries = entries(path.join(agent_path, "delegations/closed"), false);
    if (closed_entries.length) inspect(path.join(agent_path, "delegations/closed"), () => {
      const source = open_source(path.join(agent_path, "sessions.db"));
      const closed = new Map(closed_entries.map(item => [item.name, item]));
      try {
        const identities = new Map(agent.identities.map(item => [item.session_key, item]));
        const matches = new Map();
        for (const row of source.prepare("SELECT DISTINCT session_key,turn_id FROM messages WHERE turn_id IS NOT NULL").iterate()) {
          const identity = identities.get(row.session_key);
          const hash = id => create_hash("sha256").update(JSON.stringify([agent.agent_id, identity.category, id, row.turn_id])).digest("hex");
          const old_key = hash(identity.source_session_id); const file = closed.get(old_key);
          if (!file) continue;
          const targets = matches.get(old_key) ?? new Set(); targets.add(hash(identity.session_id)); matches.set(old_key, targets);
        }
        for (const [old_key, targets] of matches) {
          const file = closed.get(old_key);
          const raw = fs.readFileSync(file.file_path, "utf8");
          if (raw !== "closed") fail("delegation_closed_turn_invalid");
          if (targets.size !== 1) {
            if (!context.recovery) fail("ambiguous_closed_turn_reference");
            context.recovery.quarantine(file.file_path, raw, "ambiguous_closed_turn_reference", visit);
          } else visit(file.file_path, path.join(path.dirname(file.file_path), [...targets][0]), raw, raw);
          closed.delete(old_key);
        }
        if (closed.size && !context.recovery) fail("delegation_closed_turn_reference_missing");
        for (const file of closed.values()) {
          const raw = fs.readFileSync(file.file_path, "utf8");
          if (raw !== "closed" || !/^[a-f0-9]{64}$/u.test(file.name)) fail("delegation_closed_turn_invalid");
          context.recovery.quarantine(file.file_path, raw, "delegation_closed_turn_reference_missing", visit);
        }
      } finally { source.close(); }
    });
  }
  for (const group of entries(path.join(root_path, "groups"))) {
    for (const partition of ["sessions", "archived-sessions"]) {
      for (const session of entries(path.join(group.file_path, partition))) {
        const file_path = path.join(session.file_path, "meta.json");
        json_file(file_path, value => {
          const canonical = decodeURIComponent(session.name);
          if (![1, 2].includes(value.v) || value.group_id !== group.name) fail("group_metadata_invalid");
          if (value.session_id !== canonical) {
            if (!context.recovery || context.recovery.group_session(group.name, value.session_id) !== canonical) fail("group_metadata_invalid");
            context.recovery.record("group_session_case", path.relative(root_path, file_path), value, { source_session_id: value.session_id, session_id: canonical });
          }
          if (Object.keys(value.pending_turns ?? {}).length) fail("group_pending_legacy_dispatch");
          const member_session_ids = {}; const unavailable_members = { ...value.unavailable_member_sessions };
          for (const [agent_id, session_id] of Object.entries(value.member_session_ids ?? {})) {
            try { member_session_ids[agent_id] = resolve(agent_id, session_id, "chat", undefined, partition === "sessions"); }
            catch (error) {
              // 已删除 Agent 的会话不能成为可执行成员；共享群聊正文和原成员引用均保留。
              if (!context.recovery || !is_unavailable_reference(error) || agents.some(agent => agent.agent_id === agent_id)) throw error;
              context.recovery.record("retire_removed_group_member", path.relative(root_path, file_path), value, { member_agent_id: agent_id });
              unavailable_members[agent_id] = { session_id, reason: "agent_removed" };
            }
          }
          return { ...value, v: 2, session_id: canonical, pending_message_ids: value.pending_message_ids ?? [],
            ...(value.member_session_ids ? { member_session_ids } : {}),
            ...(Object.keys(unavailable_members).length ? { unavailable_member_sessions: unavailable_members } : {}) };
        });
      }
    }
  }
  json_file(path.join(root_path, "powers/notification/notifications.json"), items => items.map(item => {
    if (item.target?.kind === "group_session" && context.recovery) return { ...item, target: { ...item.target,
      session_id: context.recovery.group_session(item.target.group_id, item.target.session_id) } };
    if (item.target?.kind !== "agent_session") return item;
    const target = item.target;
    const { storage_id, ...rest } = target;
    return { ...item, target: { ...rest, session_id: resolve(target.agent_id, target.session_id, target.category, storage_id, !storage_id) } };
  }));
  for (const task of entries(path.join(root_path, "powers/task/tasks"))) {
    const file_path = path.join(task.file_path, "task.toml");
    inspect(file_path, () => {
    if (!exists(file_path)) fail("task_definition_missing");
    ordinary(file_path);
    const raw = fs.readFileSync(file_path, "utf8");
    const document = parse_toml(raw);
    if (!document.delivery_session) { visit(file_path, file_path, raw, raw); return; }
    const delivery = document.delivery_session;
    let next;
    try { next = resolve(delivery.agent_id, delivery.session_id, delivery.category, undefined, true); }
    catch (error) {
      if (!context.recovery || !is_unavailable_reference(error)) throw error;
      context.recovery.record("pause_task_delivery", path.relative(root_path, file_path), raw, { reason: error.migration_code ?? error.message });
      delete document.delivery_session; document.schedule = "paused";
      // 原投递目标留在完整备份和不可执行的审计字段中，不能回落到其他会话。
      document.unavailable_delivery = { reason: error.migration_code ?? error.message, original: delivery };
    }
    // TOML 重新编码只改变表示，不改变 prompt 或任何非引用字段的解析值。
    if (next) document.delivery_session = { ...delivery, session_id: next };
    const text = stringify_toml(document);
    if (digest(parse_toml(text)) !== digest(document)) fail("task_document_roundtrip_failed");
    visit(file_path, file_path, raw, text);
    });
  }
  // Memory 的持久身份包含请求键、订阅哈希和 Session；尚未声明的旧协议不得静默漏迁。
  const memory_root = path.join(root_path, "powers/memory");
  if (exists(memory_root)) {
    const walk = directory => {
      for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        const file_path = path.join(directory, entry.name);
        if (entry.isSymbolicLink()) fail("unsafe_storage_path");
        if (entry.isDirectory()) {
          if (["jobs", "subscriptions"].includes(entry.name) && entries(file_path, false).some(item => item.name.endsWith(".json"))) fail("memory_reference_migration_required");
          walk(file_path);
        }
      }
    };
    inspect(memory_root, () => walk(memory_root));
  }
}

/** 独立 Messenger/Chat 库只转换会话路由，队列和渠道载荷保持完整。 */
export function convert_channel_database(database, prefix, resolve, recovery) {
  const tables = new Set(database.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(row => row.name));
  const table = `${prefix}_conversations`;
  if (!tables.has(table)) fail("channel_database_schema_unknown");
  database.exec("PRAGMA foreign_keys=ON; BEGIN IMMEDIATE;");
  try {
    for (const row of database.prepare(`SELECT * FROM ${table}`).all()) {
      try {
        database.prepare(`UPDATE ${table} SET session_id=? WHERE conversation_id=?`)
          .run(resolve(row.agent_id, row.session_id, "chat", undefined, true), row.conversation_id);
      } catch (error) {
        if (!recovery || !is_unavailable_reference(error) || !Object.hasOwn(row, "status")) throw error;
        // 当前 Messenger 领域要求非空 Session 绑定；暂停也不能写入其无法读取的空身份。
        // 旧 Chat 库可以离线停用；Messenger 必须先在其所属领域完成显式重新绑定。
        if (prefix === "messenger") fail("messenger_route_requires_rebind");
        recovery.record("pause_channel_route", `powers/${prefix}/${prefix}.db`, row, { conversation_id: row.conversation_id, reason: error.migration_code ?? error.message });
        database.prepare(`UPDATE ${table} SET session_id='',status='paused' WHERE conversation_id=?`).run(row.conversation_id);
        const meta = `${prefix}_meta`;
        if (!tables.has(meta)) fail("channel_recovery_meta_missing");
        database.prepare(`INSERT INTO ${meta}(key,value,updated_at) VALUES(?,?,?)`).run(`session_unavailable:${row.conversation_id}`,
          JSON.stringify({ reason: error.migration_code ?? error.message, original_session_id: row.session_id }), row.updated_at);
        for (const [name, transient] of [[`${prefix}_inbox`, "'received','pending','processing','retry_wait'"], [`${prefix}_outbox`, "'pending','sending','retry_wait'"]]) {
          if (tables.has(name)) database.prepare(`UPDATE ${name} SET status='failed',lease_expires_at=NULL,error='source_session_unavailable' WHERE conversation_id=? AND status IN (${transient})`).run(row.conversation_id);
        }
      }
    }
    if (tables.has("messenger_completion_routes")) {
      for (const row of database.prepare("SELECT agent_id,session_id,turn_id FROM messenger_completion_routes").all()) {
        database.prepare("UPDATE messenger_completion_routes SET session_id=? WHERE agent_id=? AND session_id=? AND turn_id=?")
          .run(resolve(row.agent_id, row.session_id, "chat"), row.agent_id, row.session_id, row.turn_id);
      }
    }
    const meta = `${prefix}_meta`;
    if (tables.has(meta)) {
      for (const row of database.prepare(`SELECT key,value FROM ${meta} WHERE key LIKE 'channel_session:%'`).all()) {
        const conversation = database.prepare(`SELECT agent_id FROM ${table} WHERE conversation_id=?`).get(row.key.slice("channel_session:".length));
        if (!conversation) fail("channel_upgrade_route_missing");
        const unavailable = database.prepare(`SELECT 1 FROM ${meta} WHERE key=?`).get(`session_unavailable:${row.key.slice("channel_session:".length)}`);
        if (unavailable) {
          database.prepare(`UPDATE ${meta} SET key=? WHERE key=?`).run(`unavailable_${row.key}`, row.key); continue;
        }
        database.prepare(`UPDATE ${meta} SET value=? WHERE key=?`).run(resolve(conversation.agent_id, row.value, "chat"), row.key);
      }
    }
    check_integrity(database); database.exec("COMMIT;");
  } catch (error) { database.exec("ROLLBACK;"); throw error; }
}

/** 仅枚举资源名字，不解析正文；发布/恢复前能识别规划之后新增或移除的引用资源。 */
export function reference_scope(root_path, agents) {
  const paths = [];
  const include = file_path => { if (exists(file_path)) { ordinary(file_path); paths.push(path.relative(root_path, file_path)); } };
  for (const agent of agents) {
    const agent_path = path.join(root_path, "agents", agent.agent_id);
    for (const record of entries(path.join(agent_path, "session-files"))) {
      paths.push(path.relative(root_path, record.file_path)); include(path.join(record.file_path, ".owned-attachments.json"));
    }
    for (const file of entries(path.join(agent_path, "completions"), false)) if (file.name.endsWith(".json")) include(file.file_path);
    for (const file of entries(path.join(agent_path, "delegations"), false)) if (/^[a-f0-9]{64}\.json$/u.test(file.name)) include(file.file_path);
    for (const file of entries(path.join(agent_path, "delegations/closed"), false)) include(file.file_path);
  }
  for (const group of entries(path.join(root_path, "groups"))) {
    for (const partition of ["sessions", "archived-sessions"]) {
      for (const session of entries(path.join(group.file_path, partition))) include(path.join(session.file_path, "meta.json"));
    }
  }
  for (const task of entries(path.join(root_path, "powers/task/tasks"))) include(path.join(task.file_path, "task.toml"));
  include(path.join(root_path, "powers/notification/notifications.json"));
  for (const relative of ["downcity.db", "powers/messenger/messenger.db", "powers/chat/chat.db"]) include(path.join(root_path, relative));
  const memory_root = path.join(root_path, "powers/memory");
  const memory = directory => {
    for (const file of entries(directory, false)) if (["jobs", "subscriptions"].includes(path.basename(directory)) && file.name.endsWith(".json")) include(file.file_path);
    for (const child of entries(directory)) memory(child.file_path);
  };
  if (exists(memory_root)) memory(memory_root);
  const audit_root = path.join(root_path, audit_directory);
  const audit = directory => {
    for (const file of entries(directory, false)) include(file.file_path);
    for (const child of entries(directory)) audit(child.file_path);
  };
  if (exists(audit_root)) audit(audit_root);
  return paths.sort();
}
