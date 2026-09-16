/**
 * @file 验证 Sound capability 的模型发现、ASR/TTS 调用与程序化转写入口。
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

/** 创建绑定测试语音服务的 City，并返回其 Agent、Workspace 与工具集合。 */
async function create_fixture(options = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "downcity-sound-capability-"));
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
  return {
    root,
    workspace_path,
    workspace,
    agent,
    city,
    tools: city.get_session_tools(agent.id, workspace),
    close: async () => {
      await city.close();
      await workspace.dispose();
      await fs.rm(root, { recursive: true, force: true });
    },
  };
}

/** 调用一次能力工具。 */
async function call_tool(tool, input) {
  return await tool.execute(input, { tool_call_id: "call_1", messages: [], context: {} });
}

test("Sound capability 暴露三个一等工具与 system 说明", async () => {
  const fixture = await create_fixture({ asr: () => ({ text: "hi" }), tts: () => ({}) });
  try {
    for (const name of ["sound_models", "asr", "tts"]) {
      assert.ok(fixture.tools[name], `${name} should be a first-class tool`);
    }
    assert.ok(fixture.tools.image_create, "image capability stays available on the same agent");
    const blocks = await fixture.city.get_session_hooks(
      fixture.agent.id,
      fixture.workspace,
    ).system_blocks({ session_id: "s1" });
    assert.ok(blocks.some((block) => block.name === "sound"));
    assert.ok(blocks.some((block) => block.name === "image"));
  } finally {
    await fixture.close();
  }
});

test("Sound capability sound_models 按能力筛选", async () => {
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
    const all = await call_tool(fixture.tools.sound_models, {});
    assert.deepEqual(all.output.items.map((item) => item.id), ["asr-1", "tts-1"]);
    const only_tts = await call_tool(fixture.tools.sound_models, { capability: "tts" });
    assert.deepEqual(only_tts.output.items.map((item) => item.id), ["tts-1"]);
    await assert.rejects(
      () => call_tool(fixture.tools.sound_models, { capability: "image" }),
      /must be asr or tts/u,
    );
  } finally {
    await fixture.close();
  }
});

test("Sound capability asr 把本地音频转成 data URL", async () => {
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
    const result = await call_tool(fixture.tools.asr, {
      model: "asr-1",
      audio_path: "./input.mp3",
      language: "en",
    });
    assert.equal(result.output.text, "hello world");
    assert.match(received.data_url, /^data:audio\/mpeg;base64,/u);
    assert.equal(received.filename, "input.mp3");
    assert.equal("audio_path" in received, false);
  } finally {
    await fixture.close();
  }
});

test("Sound capability asr 要求且只接受一个来源", async () => {
  const fixture = await create_fixture({ asr: () => ({ text: "hi" }), tts: () => ({}) });
  try {
    await assert.rejects(() => call_tool(fixture.tools.asr, {}), /exactly one of/u);
    await assert.rejects(
      () => call_tool(fixture.tools.asr, { url: "https://a/b.mp3", data_url: "data:audio/mpeg;base64,AA" }),
      /exactly one of/u,
    );
  } finally {
    await fixture.close();
  }
});

test("Sound capability asr 未指定模型时取第一个可用 ASR 模型", async () => {
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
    await call_tool(fixture.tools.asr, { url: "https://example.com/a.mp3" });
    assert.equal(received.model, "asr-1");
  } finally {
    await fixture.close();
  }
});

test("Sound capability 没有可用模型时明确失败", async () => {
  const fixture = await create_fixture({
    list_models: () => [],
    asr: () => ({ text: "hi" }),
    tts: () => ({}),
  });
  try {
    await assert.rejects(
      () => call_tool(fixture.tools.asr, { url: "https://example.com/a.mp3" }),
      /no asr model is available/u,
    );
  } finally {
    await fixture.close();
  }
});

test("Sound capability tts 要求音频已落盘并返回 Agent Parts", async () => {
  const fixture = await create_fixture({
    asr: () => ({ text: "hi" }),
    tts: () => ({
      role: "agent",
      parts: [{ type: "file", media_type: "audio/mpeg", url: "/tmp/out.mp3" }],
    }),
  });
  try {
    const result = await call_tool(fixture.tools.tts, {
      model: "tts-1",
      text: "hello",
      voice: "alloy",
    });
    assert.equal(result.messages.length, 1);
    assert.equal(result.messages[0].parts[0].media_type, "audio/mpeg");
  } finally {
    await fixture.close();
  }
});

test("Sound capability tts 拒绝远程或 data URL 音频", async () => {
  const fixture = await create_fixture({
    asr: () => ({ text: "hi" }),
    tts: () => ({
      role: "agent",
      parts: [{ type: "file", media_type: "audio/mpeg", url: "https://example.com/out.mp3" }],
    }),
  });
  try {
    await assert.rejects(
      () => call_tool(fixture.tools.tts, { model: "tts-1", text: "hello" }),
      /must be saved locally/u,
    );
  } finally {
    await fixture.close();
  }
});

test("Sound capability tts 缺少音频 part 时失败", async () => {
  const fixture = await create_fixture({
    asr: () => ({ text: "hi" }),
    tts: () => ({ role: "agent", parts: [{ type: "text", text: "no audio" }] }),
  });
  try {
    await assert.rejects(
      () => call_tool(fixture.tools.tts, { model: "tts-1", text: "hello" }),
      /must contain an audio file part/u,
    );
  } finally {
    await fixture.close();
  }
});

test("Sound capability 程序化 transcribe 供插件调用", async () => {
  const fixture = await create_fixture({
    list_models: () => [{ id: "asr-1", modalities: ["asr"] }],
    asr: () => ({ text: "transcribed", durationInSeconds: 1.5 }),
    tts: () => ({}),
  });
  try {
    await register_voice_probe(fixture);
    const result = await invoke_transcribe(fixture, { url: "https://example.com/a.mp3" });
    assert.equal(result.success, true);
    assert.equal(result.data.text, "transcribed");
    const invalid = await invoke_transcribe(fixture, {});
    assert.equal(invalid.success, false);
    assert.match(String(invalid.error), /exactly one of/u);
  } finally {
    await fixture.close();
  }
});

/** 登记一个只转发 sound capability 的探针 Plugin。 */
async function register_voice_probe(fixture) {
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
          execute: async ({ context, input: action_input }) => ({
            success: true,
            data: await context.city.capabilities.invoke({
              capability: "sound",
              action: "transcribe",
              input: action_input,
            }),
          }),
        },
      },
    },
  });
}

/** 通过探针 Plugin 借用 City 的 sound capability。 */
async function invoke_transcribe(fixture, input) {
  return await fixture.city.plugins
    .scope({ agent_id: fixture.agent.id, workspace_id: fixture.workspace.id })
    .run_action({ plugin: "voice-probe", action: "run", payload: input });
}
