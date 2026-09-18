/**
 * @file 验证统一 SessionComposer 只读取快照并返回模型输入或压缩计划。
 */

import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { MockModelClient } from "../../agent/scripts/ModelClientMock.mjs";
import {
  Agent,
  DefaultSessionComposer,
  FullHistoryContextPolicy,
  Session,
} from "../../agent/bin/index.js";
import { Workspace } from "@downcity/city";

function create_input(model) {
  const canonical_messages = [{
    message_id: "user-1",
    session_id: "composer-session",
    turn_id: "turn-1",
    sequence: 1,
    revision: 1,
    visibility: "visible",
    created_at: 1,
    updated_at: 1,
    role: "user",
    parts: [{
      part_id: "text-1",
      type: "text",
      text: "hello",
    }],
  }];
  return {
    session: {
      agent_id: "composer-agent",
      session_id: "composer-session",
      project_root: "/tmp/composer-project",
      created_at: 1,
      timezone: "UTC",
    },
    state: {
      model,
      env: {},
      systems: ["Base instruction"],
      tools: {},
      instruction_system_blocks: [{
        source: "instruction",
        name: "agent",
        content: "Base instruction",
      }],
      managed_power_system_blocks: [],
      power_system_blocks: [],
      power_context_blocks: [],
    },
    storage: {
      list_messages: async () => structuredClone(canonical_messages),
      composer_storage: () => ({
        list_messages: async () => structuredClone(canonical_messages),
        transaction: async () => undefined,
      }),
    },
    turn: { turn_id: "turn-1", retry_count: 0 },
  };
}

test("DefaultSessionComposer 从 canonical 快照组装 Step 输入", async () => {
  const model = new MockModelClient({ modelId: "composer-model" });
  const input = create_input(model);
  const step = await new DefaultSessionComposer({ context_policy: new FullHistoryContextPolicy() }).compose(input);

  assert.equal(step.messages.length, 1);
  assert.equal(step.messages[0].content[0].text, "hello");
  assert.equal(step.system_blocks[0].content, "Base instruction");
  assert.match(step.system.at(-1).content, /composer-session/);
});

test("DefaultSessionComposer 只把 Power Context 注入模型副本", async () => {
  const model = new MockModelClient({ modelId: "composer-context-model" });
  const input = create_input(model);
  input.state.power_context_blocks = [{
    source_power: "memory",
    name: "recall",
    content: "用户偏好使用中文。",
    trust_level: "reference",
  }];
  const step = await new DefaultSessionComposer({ context_policy: new FullHistoryContextPolicy() }).compose(input);

  assert.match(step.messages[0].content[0].text, /extension-context/);
  assert.match(step.messages[0].content[0].text, /用户偏好使用中文/);
  assert.equal(step.messages[0].content[1].text, "hello");
});

test("Custom Composer 可以覆盖组装结果而不接触持久化", async () => {
  class CustomComposer extends DefaultSessionComposer {
    async compose(input) {
      const step = await super.compose(input);
      return {
        ...step,
        system: [
          ...step.system,
          { role: "system", content: "Custom behavior" },
        ],
      };
    }
  }

  const model = new MockModelClient({ modelId: "custom-composer-model" });
  const input = create_input(model);
  const step = await new CustomComposer().compose(input);

  assert.equal(step.system.at(-1).content, "Custom behavior");
});

test("Session system 快照与 Custom Composer 的实际模型输入一致", async () => {
  class CustomComposer extends DefaultSessionComposer {
    async compose(input) {
      const step = await super.compose(input);
      return {
        ...step,
        system: [
          ...step.system,
          { role: "system", content: "Custom snapshot behavior" },
        ],
      };
    }
  }

  class CustomSession extends Session {
    constructor(options) {
      super({ ...options, create_composer: () => new CustomComposer() });
    }
  }

  const project_root = await fs.mkdtemp(
    path.join(os.tmpdir(), "downcity-session-composer-system-"),
  );
  const agent = new Agent({
    id: "custom_composer_agent",
    model: new MockModelClient({ modelId: "custom-composer-model" }),
    session_class: CustomSession,
  });
  const workspace = new Workspace({ id: "test_workspace", path: project_root, data_root_path: path.join(project_root, "data") });
  try {
    const session = await agent.sessions.create({
      session_id: "custom_composer_session",
      workspace,
    });
    const snapshot = await session.system();
    assert.equal(snapshot.blocks.at(-1).content, "Custom snapshot behavior");
    assert.equal(snapshot.blocks.at(-1).source, "session");
  } finally {
    await agent.dispose();
    await fs.rm(project_root, { recursive: true, force: true });
  }
});

test("Agent Composer 工厂为创建、恢复缓存与 Fork 保持实例隔离", async () => {
  const composer_instances = [];
  const agent = new Agent({
    id: "composer_factory_agent",
    session_composer: () => {
      const composer = new DefaultSessionComposer({
        context_policy: new FullHistoryContextPolicy(),
      });
      composer_instances.push(composer);
      return composer;
    },
  });
  try {
    const first = await agent.sessions.create();
    const second = await agent.sessions.create();
    assert.equal(composer_instances.length, 2);
    assert.notEqual(composer_instances[0], composer_instances[1]);

    const restored = await agent.sessions.get(first.id);
    assert.equal(restored, first);
    assert.equal(composer_instances.length, 2);

    const forked = await first.fork();
    assert.ok(forked.id);
    assert.equal(composer_instances.length, 3);
    assert.notEqual(composer_instances[0], composer_instances[2]);
    assert.notEqual(second.id, forked.id);
  } finally {
    await agent.dispose();
  }
});
