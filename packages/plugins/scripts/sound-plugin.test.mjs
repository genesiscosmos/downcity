/**
 * @file SoundPlugin 的 FED 模型发现、ASR/TTS 调用和自动转写测试。
 *
 * 关键点（中文）
 * - 测试编译后的公开入口，确保 package 导出与用户实际使用方式一致。
 * - ASR 测试验证本地音频只会转成 data URL，不会把本地路径传给 FED。
 * - TTS 测试验证输出严格使用 AI SDK UIMessage。
 */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { SoundPlugin } from "../bin/index.js";

function create_context(root_path) {
  return {
    workspace_path: root_path,
  };
}

async function run_action(plugin, action_name, context, input) {
  return await plugin.actions[action_name].execute({
    context,
    input,
    plugin_name: plugin.name,
    action_name: action_name,
  });
}

function create_tts_message(url = "data:audio/mpeg;base64,dGVzdA==") {
  return {
    id: "sound:test",
    role: "assistant",
    parts: [
      {
        type: "file",
        mediaType: "audio/mpeg",
        filename: "speech.mp3",
        url,
      },
    ],
  };
}

test("sound.models 只返回 FED 中支持 ASR 或 TTS 的模型", async () => {
  const plugin = new SoundPlugin({
    list_models: () => [
      { id: "asr", name: "ASR", modalities: ["asr"] },
      { id: "tts", name: "TTS", modalities: ["tts"] },
      { id: "both", name: "Both", modalities: ["asr", "tts"] },
      { id: "text", name: "Text", modalities: ["text"] },
    ],
    asr: async () => ({ text: "ok" }),
    tts: async () => create_tts_message(),
  });
  const context = create_context(process.cwd());

  const all_result = await run_action(plugin, "models", context, {});
  assert.equal(all_result.success, true);
  assert.deepEqual(all_result.data.items.map((model) => model.id), ["asr", "tts", "both"]);

  const asr_result = await run_action(plugin, "models", context, { capability: "asr" });
  assert.equal(asr_result.success, true);
  assert.deepEqual(asr_result.data.items.map((model) => model.id), ["asr", "both"]);

  const tts_result = await run_action(plugin, "models", context, { capability: "tts" });
  assert.equal(tts_result.success, true);
  assert.deepEqual(tts_result.data.items.map((model) => model.id), ["tts", "both"]);
});

test("sound.asr 把本地音频转为 data URL 后直接调用 FED", async () => {
  const root_path = await fs.mkdtemp(path.join(os.tmpdir(), "downcity-sound-"));
  const audio_path = path.join(root_path, "voice.wav");
  await fs.writeFile(audio_path, Buffer.from("audio-test"));
  let received_input;
  const plugin = new SoundPlugin({
    default_asr_model: "fed-asr",
    asr: async (input) => {
      received_input = input;
      return {
        text: " transcript ",
        segments: [{ text: " first ", startSecond: 0, endSecond: 1.25 }],
        language: "en",
        durationInSeconds: 1.25,
      };
    },
    tts: async () => create_tts_message(),
  });

  try {
    const result = await run_action(
      plugin,
      "asr",
      create_context(root_path),
      { audio_path: "./voice.wav" },
    );
    assert.equal(result.success, true);
    assert.equal(received_input.model, "fed-asr");
    assert.equal(received_input.audio_path, undefined);
    assert.equal(received_input.media_type, "audio/wav");
    assert.equal(received_input.filename, "voice.wav");
    assert.match(received_input.data_url, /^data:audio\/wav;base64,/);
    assert.deepEqual(result.data, {
      text: "transcript",
      segments: [{ text: "first", startSecond: 0, endSecond: 1.25 }],
      language: "en",
      durationInSeconds: 1.25,
    });
  } finally {
    await fs.rm(root_path, { recursive: true, force: true });
  }
});

test("sound.tts 使用默认参数并返回 AI SDK UIMessage", async () => {
  let received_input;
  const message = create_tts_message();
  const plugin = new SoundPlugin({
    default_tts_model: "fed-tts",
    language: "zh",
    voice: "alloy",
    format: "mp3",
    asr: async () => ({ text: "ok" }),
    tts: async (input) => {
      received_input = input;
      return message;
    },
  });

  const result = await run_action(
    plugin,
    "tts",
    create_context(process.cwd()),
    { text: " 你好 " },
  );
  assert.equal(result.success, true);
  assert.deepEqual(received_input, {
    model: "fed-tts",
    text: "你好",
    language: "zh",
    voice: "alloy",
    format: "mp3",
  });
  assert.deepEqual(result.data, message);
});

test("sound action 不会隐式选择模型或接受非 UIMessage TTS 结果", async () => {
  const plugin = new SoundPlugin({
    asr: async () => ({ text: "ok" }),
    tts: async () => ({ url: "https://example.com/speech.mp3" }),
  });
  const context = create_context(process.cwd());

  const asr_result = await run_action(plugin, "asr", context, {
    url: "https://example.com/input.mp3",
  });
  assert.equal(asr_result.success, false);
  assert.match(asr_result.error, /requires a model id/);

  const tts_result = await run_action(plugin, "tts", context, {
    model: "fed-tts",
    text: "hello",
  });
  assert.equal(tts_result.success, false);
  assert.match(tts_result.error, /must return an AI SDK UIMessage/);
});

test("sound.asr 只接受一种音频来源", async () => {
  const plugin = new SoundPlugin({
    asr: async () => ({ text: "ok" }),
    tts: async () => create_tts_message(),
  });
  const result = await run_action(plugin, "asr", create_context(process.cwd()), {
    model: "fed-asr",
    url: "https://example.com/input.mp3",
    data_url: "data:audio/mpeg;base64,dGVzdA==",
  });
  assert.equal(result.success, false);
  assert.match(result.error, /requires exactly one/);
});

test("sound.tts 要求 UIMessage 包含音频 file part", async () => {
  const plugin = new SoundPlugin({
    asr: async () => ({ text: "ok" }),
    tts: async () => ({
      id: "sound:text-only",
      role: "assistant",
      parts: [{ type: "text", text: "not audio" }],
    }),
  });
  const result = await run_action(plugin, "tts", create_context(process.cwd()), {
    model: "fed-tts",
    text: "hello",
  });
  assert.equal(result.success, false);
  assert.match(result.error, /must contain an audio file part/);
});

test("auto_asr 必须配置默认 ASR 模型", () => {
  assert.throws(
    () => new SoundPlugin({
      auto_asr: true,
      asr: async () => ({ text: "ok" }),
      tts: async () => create_tts_message(),
    }),
    /auto_asr requires default_asr_model/,
  );
});

test("auto_asr 把 chat 语音附件转写追加到正文", async () => {
  const root_path = await fs.mkdtemp(path.join(os.tmpdir(), "downcity-sound-auto-"));
  const audio_path = path.join(root_path, "message.ogg");
  await fs.writeFile(audio_path, Buffer.from("voice"));
  const plugin = new SoundPlugin({
    auto_asr: true,
    default_asr_model: "fed-asr",
    asr: async () => ({ text: "hello <world>" }),
    tts: async () => create_tts_message(),
  });

  try {
    const hook = Object.values(plugin.hooks.pipeline)[0][0];
    const result = await hook({
      context: create_context(root_path),
      value: {
        channel: "telegram",
        chatId: "chat-1",
        workspace_path: root_path,
        body_text: "original",
        attachments: [
          {
            channel: "telegram",
            kind: "voice",
            path: audio_path,
            fileName: "message.ogg",
            contentType: "audio/ogg",
          },
        ],
      },
    });
    assert.equal(
      result.body_text,
      "original\n\n<voice src=\"message.ogg\">hello &lt;world&gt;</voice>",
    );
  } finally {
    await fs.rm(root_path, { recursive: true, force: true });
  }
});
