/**
 * @file 验证 Session 初始化图并发复用成功任务，并在临时存储失败后允许重试。
 */

import assert from "node:assert/strict";
import test from "node:test";
import { Session } from "../bin/session/Session.js";

/** 创建可以精确观测初始化调用次数的最小 Session。 */
function create_session(overrides = {}) {
  const calls = {
    initialize_messages: 0,
    read_instruction: 0,
    read_metadata: 0,
    write_metadata: 0,
  };
  let initialize_promise;
  const store = {
    session_id: "initialization-session",
    origin: { type: "chat" },
    attachments: {},
    initialize: async () => {
      if (!initialize_promise) initialize_promise = (async () => {
        calls.initialize_messages += 1;
        await overrides.initialize_messages?.(calls.initialize_messages);
      })();
      await initialize_promise;
    },
    list_messages: async () => [],
    list_recoverable_agent_messages: async () => [],
    message_stats: async () => ({ message_count: 0, storage_bytes: 0, latest_message: null }),
    composer_storage: () => ({
      list_messages: async () => [],
      transaction: async (operation) => operation({
        execute: () => {},
        get: () => null,
        all: () => [],
      }),
    }),
    read_instruction: async () => {
      calls.read_instruction += 1;
      return await overrides.read_instruction?.(calls.read_instruction) ?? null;
    },
    read_metadata: async () => {
      calls.read_metadata += 1;
      return await overrides.read_metadata?.(calls.read_metadata) ?? {};
    },
    write_metadata: async () => {
      calls.write_metadata += 1;
    },
    has_instruction: async () => false,
    write_instruction: async () => {},
  };
  const session = new Session({
    agent_id: "initialization-agent",
    workspace_path: "/tmp/downcity-session-initialization",
    origin: store.origin,
    store,
    create_session_store: () => store,
    register_forked_session: () => {},
    session_id: store.session_id,
    get_tools: () => ({}),
    logger: { log: async () => {} },
    instruction_system_blocks: [],
    get_instruction_system_blocks: () => [],
    get_workspace_env: () => ({}),
    get_hooks: () => ({}),
    get_managed_plugin_system_blocks: async () => [],
    get_agent_model: () => undefined,
  });
  return { calls, session };
}

/** 创建由测试显式释放的异步门。 */
function create_gate() {
  let release;
  const promise = new Promise((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

test("Session 并发初始化共享完整初始化图", async () => {
  const gate = create_gate();
  const { calls, session } = create_session({
    read_instruction: async () => {
      await gate.promise;
      return null;
    },
  });

  const first = session.initialize();
  const second = session.initialize();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls.initialize_messages, 1);
  assert.equal(calls.read_instruction, 1);
  assert.equal(calls.read_metadata, 1);
  assert.ok(calls.write_metadata <= 1);

  gate.release();
  assert.equal(await first, session);
  assert.equal(await second, session);
  assert.equal(await session.initialize(), session);
  assert.deepEqual(calls, {
    initialize_messages: 1,
    read_instruction: 1,
    read_metadata: 1,
    write_metadata: 1,
  });
});

test("SessionComposition 恢复失败后允许 Session 重试", async () => {
  const { calls, session } = create_session({
    read_instruction: async (attempt) => {
      if (attempt === 1) throw new Error("instruction unavailable");
      return null;
    },
  });

  await assert.rejects(session.initialize(), /instruction unavailable/);
  await session.initialize();
  assert.equal(calls.read_instruction, 2);
  assert.equal(calls.initialize_messages, 1);
  assert.equal(calls.read_metadata, 1);
});

test("SessionState 恢复失败后允许 Session 重试", async () => {
  const { calls, session } = create_session({
    read_metadata: async (attempt) => {
      if (attempt === 1) throw new Error("metadata unavailable");
      return {};
    },
  });

  await assert.rejects(session.initialize(), /metadata unavailable/);
  await session.initialize();
  assert.equal(calls.read_metadata, 2);
  assert.equal(calls.write_metadata, 1);
  assert.equal(calls.read_instruction, 1);
  assert.equal(calls.initialize_messages, 1);
});
