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
  // power 注册是异步 lifecycle；执行前先等 City ready。
  await city.ensure_ready();
  const tools = city.get_session_tools(agent.id, workspace);
  return {
    root,
    workspace_path,
    workspace,
    agent,
    city,
    tools,
    /**
     * 调用一次 city 工具。
     *
     * 关键点（中文）
     * - 只接受 `{ action: "sound.asr", args }` 形式；工具层返回 ActionResult，
     *   这里只暴露模型侧 output。
     */
    call: async ({ action, args } = {}) => {
      const result = await tools.city.execute(
        args === undefined ? { action } : { action, args },
        {
          tool_call_id: "call_1",
          messages: [],
          context: {
            session_turn_context: {
              session: { session_id: "session_test", turn_id: "turn_test", origin: { type: "chat" } },
              step: { hook_context: () => ({ session_id: "session_test", turn_id: "turn_test" }) },
            },
          },
        },
      );
      return result.output;
    },
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
    assert.deepEqual(Object.keys(fixture.tools).sort(), ["city", "shell"]);
    const index = await fixture.call({});
    const action_ids = index.data.actions.map((item) => item.action);
    assert.ok(action_ids.includes("sound.asr"));
    assert.ok(action_ids.includes("image.create"));
    const sound_actions = index.data.actions.filter((item) => item.action.startsWith("sound."));
    assert.deepEqual(
      sound_actions.map((item) => item.action),
      ["sound.asr", "sound.models", "sound.tts"],
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
    const all = await fixture.call({ action: "sound.models" });
    assert.deepEqual(all.data.items.map((item) => item.id), ["asr-1", "tts-1"]);
    const only_tts = await fixture.call({ action: "sound.models",
      args: { capability: "tts" },
    });
    assert.deepEqual(only_tts.data.items.map((item) => item.id), ["tts-1"]);
    const invalid = await fixture.call({ action: "sound.models",
      args: { capability: "image" },
    });
    assert.equal(invalid.success, false);
    assert.match(invalid.error, /Invalid payload for city\.sound\.models/u);
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
    const result = await fixture.call({ action: "sound.asr",
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
    const none = await fixture.call({ action: "sound.asr" });
    assert.equal(none.success, false);
    assert.match(none.error, /exactly one of/u);
    const both = await fixture.call({ action: "sound.asr",
      args: { url: "https://a/b.mp3", data_url: "data:audio/mpeg;base64,AA" },
    });
    assert.equal(both.success, false);
    assert.match(both.error, /exactly one of/u);
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
    await fixture.call({ action: "sound.asr",
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
    const result = await fixture.call({ action: "sound.asr",
      args: { url: "https://example.com/a.mp3" },
    });
    assert.equal(result.success, false);
    assert.match(result.error, /no asr model is available/u);
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
    const result = await fixture.call({ action: "sound.tts",
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
    const result = await fixture.call({ action: "sound.tts",
      args: { model: "tts-1", text: "hello" },
    });
    assert.equal(result.success, false);
    assert.match(result.error, /must be saved locally/u);
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
    const result = await fixture.call({ action: "sound.tts",
      args: { model: "tts-1", text: "hello" },
    });
    assert.equal(result.success, false);
    assert.match(result.error, /must contain an audio file part/u);
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
    await fixture.city.powers.add({
      readme: import.meta.filename,
      has_config: false,
      has_sidebar: false,
      has_mainview: false,
      power: {
        name: "voice-probe",
        title: "Voice Probe",
        description: "test",
        actions: {
          run: {
            description: "invoke sound asr",
            execute: async ({ context, input }) => {
              const result = await context.city.powers.run_action({
                power: "city",
                action: "sound.asr",
                payload: input,
              });
              return {
                success: result.success,
                ...(result.data === undefined ? {} : { data: result.data }),
                ...(result.error ? { error: result.error } : {}),
              };
            },
          },
        },
      },
    });
    const run = async (payload) =>
      await fixture.city.powers
        .scope({ agent_id: fixture.agent.id, workspace_id: fixture.workspace.id })
        .run_action({ power: "voice-probe", action: "run", payload });

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
