/**
 * @file 验证 Plugin 动态 Interaction 不依赖核心固定业务联合体。
 */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { JsonlSessionMessageStore } from "../bin/workspace/store/JsonlSessionMessageStore.js";
import { LocalFileSystem } from "@downcity/workspace";
import { SessionMessages } from "../bin/session/SessionMessages.js";
import { SessionInteractions } from "../bin/session/control/SessionInteractions.js";

test("动态 Plugin Interaction 使用通用 type/payload 完成恢复", async () => {
  const root_path = await fs.mkdtemp(path.join(os.tmpdir(), "downcity-dynamic-interaction-"));
  const recorder = new SessionMessages({
    session_id: "dynamic-interaction-test",
    store: new JsonlSessionMessageStore({
      files: new LocalFileSystem(root_path),
      session_id: "dynamic-interaction-test",
      file_path: path.join(root_path, "active.jsonl"),
    }),
    publish: () => {},
  });
  await recorder.initialize();
  const interactions = new SessionInteractions({
    session_id: "dynamic-interaction-test",
    messages: recorder,
  });
  const writer = await recorder.open_assistant_message({ turn_id: "turn-1" });

  try {
    const handle = await interactions.request({
      interaction_id: "interaction:deploy-confirm",
      turn_id: "turn-1",
      type: "plugin:deployment/confirm",
      source: {
        type: "plugin",
        plugin_name: "deployment",
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
        payload: { decision: "confirmed" },
      },
    });

    assert.deepEqual(await handle.result, result);
    assert.equal(result.status, "resolved");
    assert.deepEqual(result.response.payload, { decision: "confirmed" });
    assert.equal(recorder.get_message(writer.message_id).parts[0].status, "resolved");
  } finally {
    await fs.rm(root_path, { recursive: true, force: true });
  }
});
