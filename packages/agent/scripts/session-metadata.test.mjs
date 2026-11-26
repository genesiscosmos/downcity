/** 精确元数据在真实 Worker 和内存库中的身份隔离；不枚举目录、不恢复执行器。 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID as random_uuid } from 'node:crypto';
import { acquire_agent_session_storage } from '../bin/session/storage/agent-db/AgentSessionRuntime.js';
import { Agent } from '../bin/index.js';

for (const memory of [true, false]) {
  test(`${memory ? '内存' : 'Worker'} 批量 metadata 按原 UUID 区分归档与重建，缺失明确 null`, async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'downcity-metadata-'));
    const lease = await acquire_agent_session_storage({ agent_id: 'a', database_path: memory ? ':memory:' : path.join(directory, 'sessions.db'),
      memory_scope: random_uuid(), allow_create: true }, false);
    const old_id = random_uuid(); const new_id = random_uuid();
    const create = async session_id => lease.write('collection', { command: 'create', operation_id: random_uuid(), input: {
      session_id, type: 'chat', kind: 'conversation', timezone: 'UTC', created_at: 1,
    } });
    try {
      await create(old_id);
      await lease.write('collection', { command: 'archive', operation_id: random_uuid(), address: { archived: false, type: 'chat', session_id: old_id }, archived_at: 2 });
      await create(new_id);
      const rows = await lease.read({ command: 'metadata', addresses: [
        { type: 'chat', session_id: old_id },
        { type: 'chat', session_id: new_id },
        { type: 'chat', session_id: old_id },
        { type: 'work', session_id: old_id },
        { type: 'chat', session_id: random_uuid() },
      ] });
      assert.equal(rows[0].archived, 1); assert.equal(rows[0].session_id, old_id);
      assert.equal(rows[1].archived, 0); assert.equal(rows[1].session_id, new_id);
      // 原永久身份重复读取仍返回原归档，绝不重定向到新的主会话。
      assert.equal(rows[2].session_id, old_id); assert.equal(rows[2].archived, 1);
      assert.equal(rows[3], null); assert.equal(rows[4], null);
      await assert.rejects(lease.read({ command: 'metadata', addresses: Array.from({ length: 101 }, () => ({ type: 'chat', session_id: old_id })) }), /session_metadata_limit_invalid/);
    } finally { await lease.release(); await fs.rm(directory, { recursive: true, force: true }); }
  });
}

test('SDK 精确元数据只读租约不恢复 Session 或模型，空批次不触发存储', async () => {
  const agent = new Agent({ id: 'metadata' });
  try {
    assert.deepEqual(await agent.sessions.read_metadata([]), []);
    const session = await agent.sessions.create({ type: "chat", kind: "conversation" });
    const [active] = await agent.sessions.read_metadata([{ type: session.type, session_id: session.id }]);
    assert.equal(active.archived, false);
    await agent.sessions.archive({ type: session.type, id: session.id });
    const [archived] = await agent.sessions.read_metadata([{ type: session.type, session_id: active.session_id }]);
    assert.equal(archived.archived, true);
    const new_session = await agent.sessions.create({ type: "chat", kind: "conversation" });
    const [current] = await agent.sessions.read_metadata([{ type: new_session.type, session_id: new_session.id }]);
    assert.notEqual(current.session_id, archived.session_id);
  } finally { await agent.dispose(); }
});
