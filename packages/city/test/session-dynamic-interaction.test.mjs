/**
 * @file 验证 Extension 动态 Interaction 不依赖核心固定业务联合体。
 */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { SqliteSessionStorage } from "../../agent/bin/session/storage/SqliteSessionStorage.js";
import { LocalFileSystem } from "@downcity/city";
import { SessionMessages } from "../../agent/bin/session/SessionMessages.js";
import { SessionInteractions } from "../../agent/bin/session/control/SessionInteractions.js";

/** 写入一个完整的标准模型工具调用事件序列。 */
async function write_tool_call(writer, input) {
  await writer.apply_model_event({
    type: "tool_call_start",
    content_id: input.content_id,
    tool_call_id: input.tool_call_id,
    tool_name: input.tool_name,
  });
  if (input.input_delta) {
    await writer.apply_model_event({
      type: "tool_call_delta",
      content_id: input.content_id,
      input_delta: input.input_delta,
    });
  }
  await writer.apply_model_event({
    type: "tool_call_finish",
    content_id: input.content_id,
    input: input.tool_input,
  });
}

test("动态 Extension Interaction 使用通用 type/payload 完成恢复", async () => {
  const root_path = await fs.mkdtemp(path.join(os.tmpdir(), "downcity-dynamic-interaction-"));
  const files = new LocalFileSystem(root_path);
  const store = new SqliteSessionStorage({
    files,
    session_id: "dynamic-interaction-test",
    agent_id: "test-agent",
    origin: { type: "chat" },
    database_path: path.join(root_path, "session.db"),
    database_location: { type: "file" },
    attachments: {},
  });
  const recorder = new SessionMessages({
    session_id: "dynamic-interaction-test",
    store,
    attachment_store: store.attachments,
    publish: () => {},
  });
  await recorder.initialize();
  const interactions = new SessionInteractions({
    session_id: "dynamic-interaction-test",
    messages: recorder,
  });
  const writer = await recorder.open_agent_message({ turn_id: "turn-1" });
  await writer.begin_step();
  // Interaction 必须归属一次具体 Tool 调用：先建立承载它的工具调用。
  await write_tool_call(writer, {
    content_id: "tool-deploy",
    tool_call_id: "call-deploy",
    tool_name: "deployment_confirm",
    input_delta: '{"environment":"production"}',
    tool_input: { environment: "production" },
  });

  try {
    const handle = await interactions.request({
      interaction_id: "interaction:deploy-confirm",
      turn_id: "turn-1",
      type: "plugin:deployment/confirm",
      source: {
        type: "tool",
        tool_call_id: "call-deploy",
        tool_name: "deployment_confirm",
      },
      title: "确认发布",
      payload: {
        environment: "production",
        version: "2026.08.24",
      },
      response_schema: {
        type: "object",
        required: ["decision"],
      },
      created_at: Date.now(),
    });

    assert.deepEqual((await interactions.list())[0].request.payload, {
      environment: "production",
      version: "2026.08.24",
    });

    const result = await interactions.respond({
      interaction_id: handle.interaction_id,
      response: {
        type: "plugin:deployment/confirm",
        outcome: "resolved",
        payload: { decision: "confirmed" },
      },
    });

    assert.deepEqual(await handle.result, result);
    assert.equal(result.status, "resolved");
    assert.deepEqual(result.response.payload, { decision: "confirmed" });
    // Interaction 归属 Tool Part：断言它挂在承载本次交互的工具调用上。
    const owner = recorder.get_message(writer.message_id).parts[0];
    assert.equal(owner.type, "tool");
    assert.equal(owner.tool_call_id, "call-deploy");
    assert.deepEqual(
      owner.interactions.map((item) => item.interaction_id),
      [handle.interaction_id],
    );
    assert.equal(owner.interactions[0].status, "resolved");
  } finally {
    await fs.rm(root_path, { recursive: true, force: true });
  }
});
