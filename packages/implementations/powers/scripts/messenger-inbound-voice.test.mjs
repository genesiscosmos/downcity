/**
 * @file 验证 messenger 入站语音自动转写借用 City 的 ai power。
 *
 * 关键点（中文）
 * - 能力归 City、触发归 messenger：messenger 只负责识别附件并调用 ai power 的 `sound.asr`。
 * - 单个附件失败不得阻塞主消息链路。
 * - City 未登记 ai power 时静默跳过。
 */

import assert from "node:assert/strict";
import test from "node:test";

import { augmentMessengerInboundInput } from "../bin/messenger/runtime/InboundAugment.js";

/** 构造一个只提供 City power 调用端的 PowerContext 替身。 */
function create_context(options = {}) {
  const calls = [];
  const registered = options.powers ?? ["ai"];
  return {
    calls,
    context: {
      workspace: { path: options.workspace_path || "/tmp/workspace" },
      city: {
        powers: {
          get: (power_id) => (registered.includes(power_id) ? { name: power_id } : null),
          pipeline: async (_point, value) => {
            for (const handler of options.pipeline || []) {
              value = await handler(value);
            }
            return value;
          },
          run_action: async (input) => {
            calls.push(input);
            if (options.invoke) return await options.invoke(input);
            return { success: true, data: { text: "transcribed text" } };
          },
        },
      },
    },
  };
}

/** 构造一个带语音附件的入站输入。 */
function create_inbound(attachments) {
  return {
    body_text: "user question",
    attachments,
    powerSections: [],
  };
}

test("messenger 入站语音附件被转写为 voice 块并追加到正文", async () => {
  const fixture = create_context();
  const result = await augmentMessengerInboundInput({
    context: fixture.context,
    input: create_inbound([
      { kind: "voice", path: "/tmp/workspace/voice/one.mp3", contentType: "audio/mpeg" },
    ]),
  });
  assert.equal(fixture.calls.length, 1);
  assert.equal(fixture.calls[0].power, "ai");
  assert.equal(fixture.calls[0].action, "sound.asr");
  assert.equal(fixture.calls[0].payload.audio_path, "/tmp/workspace/voice/one.mp3");
  assert.equal(result.body_text, "user question\n\n<voice src=\"voice/one.mp3\">transcribed text</voice>");
});

test("messenger 入站忽略非语音附件", async () => {
  const fixture = create_context();
  const result = await augmentMessengerInboundInput({
    context: fixture.context,
    input: create_inbound([{ kind: "document", path: "/tmp/workspace/doc.pdf" }]),
  });
  assert.equal(fixture.calls.length, 0);
  assert.equal(result.body_text, "user question");
});

test("messenger 入站单个语音附件转写失败不影响其他附件", async () => {
  const fixture = create_context({
    invoke: async (input) => {
      if (input.payload.audio_path.endsWith("bad.mp3")) throw new Error("asr failed");
      return { success: true, data: { text: "ok" } };
    },
  });
  const result = await augmentMessengerInboundInput({
    context: fixture.context,
    input: create_inbound([
      { kind: "voice", path: "/tmp/workspace/voice/bad.mp3" },
      { kind: "audio", path: "/tmp/workspace/voice/good.mp3" },
    ]),
  });
  assert.equal(fixture.calls.length, 2);
  assert.match(result.body_text, /good\.mp3/u);
  assert.doesNotMatch(result.body_text, /bad\.mp3/u);
});

test("messenger 入站未登记 ai power 时静默跳过", async () => {
  const fixture = create_context({ powers: [] });
  const result = await augmentMessengerInboundInput({
    context: fixture.context,
    input: create_inbound([{ kind: "voice", path: "/tmp/workspace/voice/one.mp3" }]),
  });
  assert.equal(fixture.calls.length, 0);
  assert.equal(result.body_text, "user question");
});
