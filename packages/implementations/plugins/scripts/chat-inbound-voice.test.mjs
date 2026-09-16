/**
 * @file 验证 chat 入站语音自动转写借用 City 的 sound capability。
 *
 * 关键点（中文）
 * - 能力归 City、触发归 chat：chat 只负责识别附件并调用 capability。
 * - 单个附件失败不得阻塞主消息链路。
 * - City 未登记 sound capability 时静默跳过。
 */

import assert from "node:assert/strict";
import test from "node:test";

import { augmentChatInboundInput } from "../bin/chat/runtime/InboundAugment.js";

/** 构造一个只提供 city methods 端的 PluginContext 替身。 */
function create_context(options = {}) {
  const calls = [];
  return {
    calls,
    context: {
      workspace: { path: options.workspace_path || "/tmp/workspace" },
      city: {
        plugins: {
          pipeline: async (_point, value) => {
            for (const handler of options.pipeline || []) {
              value = await handler(value);
            }
            return value;
          },
        },
        methods: {
          has: (method_id) => (options.methods || []).includes(method_id),
          invoke: async (input) => {
            calls.push(input);
            if (options.invoke) return await options.invoke(input);
            return { text: "transcribed text" };
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
    pluginSections: [],
  };
}

test("chat 入站语音附件被转写为 voice 块并追加到正文", async () => {
  const fixture = create_context({ methods: ["sound"] });
  const result = await augmentChatInboundInput({
    context: fixture.context,
    input: create_inbound([
      { kind: "voice", path: "/tmp/workspace/voice/one.mp3", contentType: "audio/mpeg" },
    ]),
  });
  assert.equal(fixture.calls.length, 1);
  assert.equal(fixture.calls[0].method, "sound");
  assert.equal(fixture.calls[0].action, "transcribe");
  assert.equal(fixture.calls[0].input.audio_path, "/tmp/workspace/voice/one.mp3");
  assert.equal(result.body_text, "user question\n\n<voice src=\"voice/one.mp3\">transcribed text</voice>");
});

test("chat 入站忽略非语音附件", async () => {
  const fixture = create_context({ methods: ["sound"] });
  const result = await augmentChatInboundInput({
    context: fixture.context,
    input: create_inbound([{ kind: "document", path: "/tmp/workspace/doc.pdf" }]),
  });
  assert.equal(fixture.calls.length, 0);
  assert.equal(result.body_text, "user question");
});

test("chat 入站单个语音附件转写失败不影响其他附件", async () => {
  const fixture = create_context({
    methods: ["sound"],
    invoke: async (input) => {
      if (input.input.audio_path.endsWith("bad.mp3")) throw new Error("asr failed");
      return { text: "ok" };
    },
  });
  const result = await augmentChatInboundInput({
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

test("chat 入站未登记 sound capability 时静默跳过", async () => {
  const fixture = create_context({ methods: [] });
  const result = await augmentChatInboundInput({
    context: fixture.context,
    input: create_inbound([{ kind: "voice", path: "/tmp/workspace/voice/one.mp3" }]),
  });
  assert.equal(fixture.calls.length, 0);
  assert.equal(result.body_text, "user question");
});
