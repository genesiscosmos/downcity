/**
 * @file 验证统一 SessionComposer 只读取快照并返回模型输入或压缩计划。
 */

import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { MockLanguageModelV3 } from "ai/test";
import {
  Agent,
  DefaultSessionComposer,
  Session,
  Workspace,
} from "../bin/index.js";

function create_input(model) {
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
      managed_plugin_system_blocks: [],
      plugin_system_blocks: [],
    },
    history: {
      summary: null,
      messages: [{
        message_id: "user-1",
        session_id: "composer-session",
        turn_id: "turn-1",
        sequence: 1,
        revision: 1,
        visibility: "visible",
        created_at: 1,
        updated_at: 1,
        type: "user",
        input_type: "prompt",
        parts: [{
          part_id: "text-1",
          type: "text",
          text: "hello",
          state: "done",
        }],
      }],
    },
    turn: { turn_id: "turn-1", retry_count: 0 },
  };
}

test("DefaultSessionComposer 从 canonical 快照组装 Step 输入", async () => {
  const model = new MockLanguageModelV3({ modelId: "composer-model" });
  const input = create_input(model);
  const step = await new DefaultSessionComposer().compose(input);

  assert.equal(step.messages.length, 1);
  assert.equal(step.messages[0].parts[0].text, "hello");
  assert.equal(step.system_blocks[0].content, "Base instruction");
  assert.match(step.system.at(-1).content, /composer-session/);
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

  const model = new MockLanguageModelV3({ modelId: "custom-composer-model" });
  const input = create_input(model);
  const before = structuredClone(input.history);
  const step = await new CustomComposer().compose(input);

  assert.equal(step.system.at(-1).content, "Custom behavior");
  assert.deepEqual(input.history, before);
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
      super({ ...options, composer: new CustomComposer() });
    }
  }

  const project_root = await fs.mkdtemp(
    path.join(os.tmpdir(), "downcity-session-composer-system-"),
  );
  const agent = new Agent({
    id: "custom_composer_agent",
    workspace: new Workspace({ path: project_root }),
    model: new MockLanguageModelV3({ modelId: "custom-composer-model" }),
    session_class: CustomSession,
  });
  try {
    const session = await agent.sessions.create({
      session_id: "custom_composer_session",
    });
    const snapshot = await session.system();
    assert.equal(snapshot.blocks.at(-1).content, "Custom snapshot behavior");
    assert.equal(snapshot.blocks.at(-1).source, "session");
  } finally {
    await agent.dispose();
    await fs.rm(project_root, { recursive: true, force: true });
  }
});

test("Composer compact 只返回计划，不修改 Message 快照", async () => {
  const model = new MockLanguageModelV3({
    modelId: "composer-compact-model",
    doGenerate: async () => ({
      content: [{ type: "text", text: "Composer summary" }],
      finishReason: { unified: "stop", raw: "stop" },
      usage: {
        inputTokens: { total: 0, noCache: 0, cacheRead: 0, cacheWrite: 0 },
        outputTokens: { total: 0, text: 0, reasoning: 0 },
      },
      warnings: [],
    }),
  });
  const input = create_input(model);
  const before = structuredClone(input.history);
  const plan = await new DefaultSessionComposer().compact({
    session: input.session,
    model: input.state.model,
    history: input.history,
  });

  assert.equal(plan.through_sequence, 1);
  assert.equal(plan.summary.text, "Composer summary");
  assert.deepEqual(input.history, before);
});
