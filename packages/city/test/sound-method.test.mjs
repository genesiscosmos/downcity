/**
 * @file 验证 city tool `sound` method 的模型发现、ASR/TTS 调用与程序化转写入口。
 */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { Agent } from "@downcity/agent";
import { City, LocalStorageProvider, Workspace } from "../bin/index.js";

/** 当前测试注入的语音 AI 服务实现。 */
let current_sound_ai;

/** 创建绑定测试语音服务的 City，并返回其 Agent、Workspace 与调用入口。 */
async function create_fixture(options = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "downcity-sound-method-"));
  const workspace_path = path.join(root, "workspace");
  await fs.mkdir(workspace_path, { recursive: true });
  current_sound_ai = {
    catalog: async () => ({ all: () => (options.list_models ? options.list_models() : []) }),
    asr: options.asr,
    tts: options.tts,
  };
  const workspace = new Workspace({ id: "sound_workspace", path: workspace_path });
  const agent = new Agent({ id: "sound_agent" });
  const city = new City({
    storage: new LocalStorageProvider(root),
    workspaces: [workspace],
    embassy: { user: { ai: current_sound_ai } },
  });
  city.agents.add(agent);
  const tools = city.get_session_tools(agent.id, workspace);
  return {
    root,
    workspace_path,
    workspace,
    agent,
    city,
    tools,
    /** 调用一次 city 工具。 */
    call: async (call_input) =>
      await tools.city.execute(call_input, { tool_call_id: "call_1", messages: [], context: {} }),
    close: async () => {
      await city.close();
      await workspace.dispose();
      await fs.rm(root, { recursive: true, force: true });
    },
  };
}

test("sound method 与 image method 同在一个 city 工具里", async () => {
  const fixture = await create_fixture({ asr: () => ({ text: "hi" }), tts: () => ({}) });
  try {
    assert.deepEqual(Object.keys(fixture.tools), ["city"]);
    const index = await fixture.call({});
    const methods = index.data.methods.map((item) => item.method);
    assert.ok(methods.includes("sound"));
    assert.ok(methods.includes("image"));
    const sound_index = await fixture.call({ method: "sound" });
    assert.deepEqual(
      sound_index.data.actions.map((item) => item.action),
      ["models", "asr", "tts"],
    );
  } finally {
    await fixture.close();
  }
});

test("sound models 按能力筛选", async () => {
  const fixture = await create_fixture({
    list_models: () => [
      { id: "asr-1", name: "ASR", modalities: ["asr"] },
      { id: "tts-1", name: "TTS", modalities: ["tts"] },
      { id: "vision", name: "Vision", modalities: ["image"] },
    ],
    asr: () => ({ text: "hi" }),
    tts: () => ({}),
  });
  try {
    const all = await fixture.call({ method: "sound", action: "models" });
    assert.deepEqual(all.data.items.map((item) => item.id), ["asr-1", "tts-1"]);
    const only_tts = await fixture.call({
      method: "sound",
      action: "models",
      args: { capability: "tts" },
    });
    assert.deepEqual(only_tts.data.items.map((item) => item.id), ["tts-1"]);
    const invalid = await fixture.call({
      method: "sound",
      action: "models",
      args: { capability: "image" },
    });
    assert.equal(invalid.ok, false);
    assert.match(invalid.error.message, /must be asr or tts/u);
  } finally {
    await fixture.close();
  }
});

test("sound asr 把本地音频转成 data URL", async () => {
  let received;
  const fixture = await create_fixture({
    asr: (input) => {
      received = input;
      return { text: "hello world", language: "en" };
    },
    tts: () => ({}),
  });
  try {
    await fs.writeFile(path.join(fixture.workspace_path, "input.mp3"), "audio-bytes");
    const result = await fixture.call({
      method: "sound",
      action: "asr",
      args: { model: "asr-1", audio_path: "./input.mp3", language: "en" },
    });
    assert.equal(result.data.text, "hello world");
    assert.match(received.data_url, /^data:audio\/mpeg;base64,/u);
    assert.equal(received.filename, "input.mp3");
    assert.equal("audio_path" in received, false);
  } finally {
    await fixture.close();
  }
});

test("sound asr 要求且只接受一个音频来源", async () => {
  const fixture = await create_fixture({ asr: () => ({ text: "hi" }), tts: () => ({}) });
  try {
    const none = await fixture.call({ method: "sound", action: "asr" });
    assert.equal(none.ok, false);
    assert.match(none.error.message, /exactly one of/u);
    const both = await fixture.call({
      method: "sound",
      action: "asr",
      args: { url: "https://a/b.mp3", data_url: "data:audio/mpeg;base64,AA" },
    });
    assert.equal(both.ok, false);
    assert.match(both.error.message, /exactly one of/u);
  } finally {
    await fixture.close();
  }
});

test("sound asr 未指定模型时取第一个可用 ASR 模型", async () => {
  let received;
  const fixture = await create_fixture({
    list_models: () => [
      { id: "tts-1", modalities: ["tts"] },
      { id: "asr-1", modalities: ["asr"] },
    ],
    asr: (input) => {
      received = input;
      return { text: "hi" };
    },
    tts: () => ({}),
  });
  try {
    await fixture.call({
      method: "sound",
      action: "asr",
      args: { url: "https://example.com/a.mp3" },
    });
    assert.equal(received.model, "asr-1");
  } finally {
    await fixture.close();
  }
});

test("sound 没有可用模型时明确失败", async () => {
  const fixture = await create_fixture({
    list_models: () => [],
    asr: () => ({ text: "hi" }),
    tts: () => ({}),
  });
  try {
    const result = await fixture.call({
      method: "sound",
      action: "asr",
      args: { url: "https://example.com/a.mp3" },
    });
    assert.equal(result.ok, false);
    assert.match(result.error.message, /no asr model is available/u);
  } finally {
    await fixture.close();
  }
});

test("sound tts 要求音频已落盘并只返回本地路径", async () => {
  const fixture = await create_fixture({
    asr: () => ({ text: "hi" }),
    tts: () => ({
      role: "agent",
      parts: [{ type: "file", media_type: "audio/mpeg", url: "/tmp/out.mp3" }],
    }),
  });
  try {
    const result = await fixture.call({
      method: "sound",
      action: "tts",
      args: { model: "tts-1", text: "hello", voice: "alloy" },
    });
    assert.deepEqual(result.data, { files: ["/tmp/out.mp3"] });
  } finally {
    await fixture.close();
  }
});

test("sound tts 拒绝远程或 data URL 音频", async () => {
  const fixture = await create_fixture({
    asr: () => ({ text: "hi" }),
    tts: () => ({
      role: "agent",
      parts: [{ type: "file", media_type: "audio/mpeg", url: "https://example.com/out.mp3" }],
    }),
  });
  try {
    const result = await fixture.call({
      method: "sound",
      action: "tts",
      args: { model: "tts-1", text: "hello" },
    });
    assert.equal(result.ok, false);
    assert.match(result.error.message, /must be saved locally/u);
  } finally {
    await fixture.close();
  }
});

test("sound tts 缺少音频 part 时失败", async () => {
  const fixture = await create_fixture({
    asr: () => ({ text: "hi" }),
    tts: () => ({ role: "agent", parts: [{ type: "text", text: "no audio" }] }),
  });
  try {
    const result = await fixture.call({
      method: "sound",
      action: "tts",
      args: { model: "tts-1", text: "hello" },
    });
    assert.equal(result.ok, false);
    assert.match(result.error.message, /must contain an audio file part/u);
  } finally {
    await fixture.close();
  }
});

test("sound method 的程序化 transcribe 供插件调用", async () => {
  const fixture = await create_fixture({
    list_models: () => [{ id: "asr-1", modalities: ["asr"] }],
    asr: () => ({ text: "transcribed", durationInSeconds: 1.5 }),
    tts: () => ({}),
  });
  try {
    await fixture.city.plugins.add({
      readme: import.meta.filename,
      has_config: false,
      has_sidebar: false,
      has_mainview: false,
      plugin: {
        name: "voice-probe",
        title: "Voice Probe",
        description: "test",
        actions: {
          run: {
            description: "invoke sound transcribe",
            execute: async ({ context, input }) => ({
              success: true,
              data: await context.city.methods.invoke({
                method: "sound",
                action: "transcribe",
                input,
              }),
            }),
          },
        },
      },
    });
    const run = async (payload) =>
      await fixture.city.plugins
        .scope({ agent_id: fixture.agent.id, workspace_id: fixture.workspace.id })
        .run_action({ plugin: "voice-probe", action: "run", payload });

    const ok = await run({ url: "https://example.com/a.mp3" });
    assert.equal(ok.success, true);
    assert.equal(ok.data.text, "transcribed");
    const invalid = await run({});
    assert.equal(invalid.success, false);
    assert.match(String(invalid.error), /exactly one of/u);
  } finally {
    await fixture.close();
  }
});
