/**
 * @file 验证 ImagePlugin 的两步式图片任务协议。
 *
 * 关键点（中文）
 * - 插件只暴露 image_create / image_result 两个任务 action。
 * - image_result 默认只读取一次当前状态；传 until_done=true 时会在 plugin 层等待终态。
 * - 成功图片由 Plugin 返回已指向本地文件的 Assistant Parts。
 */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { ImagePlugin } from "../../plugins/bin/index.js";
import { PluginRegistry } from "../bin/plugin/core/PluginRegistry.js";

function create_image_plugin(options = {}) {
  const { list_models, image_create, image_result, ...profile } = options;
  return new ImagePlugin({
    ...profile,
    image_ai: {
      catalog: async () => ({ all: () => (list_models ? list_models() : []) }),
      image_create,
      image_result,
    },
  });
}

function create_image_message() {
  return {
    id: "msg_image_test",
    role: "assistant",
    parts: [
      {
        type: "file",
        mediaType: "image/png",
        filename: "image.png",
        url: "/workspace/image.png",
      },
    ],
  };
}

function create_files(workspace_path) {
  return {
    root_path: workspace_path,
    resolve_path: (...segments) => path.resolve(workspace_path, ...segments),
    path_exists: async (file_path) => {
      try {
        await fs.access(file_path);
        return true;
      } catch {
        return false;
      }
    },
    ensure_directory: (directory_path) => fs.mkdir(directory_path, { recursive: true }),
    write_file_atomically: (file_path, content) => fs.writeFile(file_path, content),
  };
}

function create_context(workspace_path = process.cwd()) {
  const data_path = path.join(workspace_path, "agent-workspace-data");
  return {
    agent_id: "image_test_agent",
    workspace_id: "image_test_workspace",
    workspace_path,
    data_path,
    files: create_files(workspace_path),
    data_files: create_files(data_path),
  };
}

function create_registry(plugin, workspace_path = process.cwd()) {
  const registry = new PluginRegistry({
    agent_id: "image_test_agent",
    instructions: [],
  }, [plugin]);
  return registry.contextual(create_context(workspace_path));
}

test("ImagePlugin exposes only job-style image actions", async () => {
  const plugin = create_image_plugin({
    image_create: () => ({ job_id: "img_1", status: "queued", poll_after_ms: 1 }),
    image_result: () => ({ job_id: "img_1", status: "queued", poll_after_ms: 1 }),
  });

  assert.equal("image_create" in plugin.actions, true);
  assert.equal("image_result" in plugin.actions, true);
  assert.equal("models" in plugin.actions, true);
  assert.equal("generate" in plugin.actions, false);
});

test("ImagePlugin image_create returns image job", async () => {
  const plugin = create_image_plugin({
    image_create: (input) => ({
      job_id: "img_1",
      status: "queued",
      poll_after_ms: 1,
      metadata: { prompt: input.prompt },
    }),
    image_result: () => ({ job_id: "img_1", status: "queued", poll_after_ms: 1 }),
  });

  const result = await plugin.actions.image_create.execute({
    context: create_context(),
    input: { prompt: "draw" },
    plugin_name: "image",
    action_name: "image_create",
  });

  assert.equal(result.success, true);
  assert.equal(result.data.job_id, "img_1");
  assert.equal(result.data.status, "queued");
});

test("ImagePlugin models lists image-capable models", async () => {
  const plugin = create_image_plugin({
    list_models: () => [
      {
        id: "text_1",
        name: "Text",
        description: "text only",
        modalities: ["text"],
        tags: ["general"],
        meta: {},
      },
      {
        id: "image_1",
        name: "Image",
        description: "image model",
        modalities: ["image"],
        tags: ["creative"],
        meta: { provider: "test" },
        default_modalities: ["image"],
      },
    ],
    image_create: () => ({ job_id: "img_1", status: "queued", poll_after_ms: 1 }),
    image_result: () => ({ job_id: "img_1", status: "queued", poll_after_ms: 1 }),
  });

  const result = await plugin.actions.models.execute({
    context: create_context(),
    input: {},
    plugin_name: "image",
    action_name: "models",
  });

  assert.equal(result.success, true);
  assert.deepEqual(result.data.items.map((item) => item.id), ["image_1"]);
  assert.equal(result.data.items[0].meta.provider, "test");
});

test("ImagePlugin exposes action metadata through plugin registry", async () => {
  const plugin = create_image_plugin({
    image_create: () => ({ job_id: "img_1", status: "queued", poll_after_ms: 1 }),
    image_result: () => ({ job_id: "img_1", status: "queued", poll_after_ms: 1 }),
  });
  const registry = create_registry(plugin);

  const metadata = registry.read({
    plugin: "image",
    action: "image_create",
  });

  assert.equal(metadata.name, "image");
  assert.equal(metadata.actions.length, 1);
  assert.equal(metadata.actions[0].name, "image_create");
  assert.equal(metadata.actions[0].has_input_schema, true);
  assert.match(metadata.actions[0].description, /Create an async image job/);
  assert.match(metadata.actions[0].description, /explicit user confirmation/);
  assert.equal(metadata.actions[0].examples[0].payload.prompt.includes("rainy city"), true);
});

test("ImagePlugin image_result reads pending state once", async () => {
  const calls = [];
  const plugin = create_image_plugin({
    image_create: () => ({ job_id: "img_1", status: "queued", poll_after_ms: 1 }),
    image_result: (input) => {
      calls.push(input.job_id);
      return {
        job_id: input.job_id,
        status: "running",
        message: "upstream pending",
        poll_after_ms: 1,
      };
    },
  });

  const result = await plugin.actions.image_result.execute({
    context: create_context(),
    input: { job_id: "img_1" },
    plugin_name: "image",
    action_name: "image_result",
  });

  assert.equal(result.success, true);
  assert.equal(result.data.job_id, "img_1");
  assert.equal(result.data.status, "running");
  assert.equal(result.data.message, "upstream pending");
  assert.deepEqual(calls, ["img_1"]);
});

test("ImagePlugin image_result returns final message when succeeded", async () => {
  const message = create_image_message();
  const plugin = create_image_plugin({
    image_create: () => ({ job_id: "img_1", status: "queued", poll_after_ms: 1 }),
    image_result: (input) => ({
      job_id: input.job_id,
      status: "succeeded",
      result: message,
      poll_after_ms: 1,
    }),
  });

  const result = await plugin.actions.image_result.execute({
    context: create_context(),
    input: { job_id: "img_1" },
    plugin_name: "image",
    action_name: "image_result",
  });

  assert.equal(result.success, true);
  assert.equal(result.data.job_id, "img_1");
  assert.equal(result.data.status, "succeeded");
  assert.deepEqual(result.data.result, message);
  assert.deepEqual(result.messages, [{
    role: "assistant",
    parts: message.parts,
  }]);
});

test("ImagePlugin image_result stores remote images locally and preserves source URLs", async (t) => {
  const workspace_path = await fs.mkdtemp(path.join(os.tmpdir(), "image-plugin-result-"));
  t.after(() => fs.rm(workspace_path, { recursive: true, force: true }));
  t.mock.method(globalThis, "fetch", async (url) => {
    const is_webp = String(url).endsWith("/second.webp");
    return new Response(is_webp ? "webp-bytes" : "png-bytes", {
      status: 200,
      headers: {
        "content-type": is_webp ? "image/webp" : "image/png",
      },
    });
  });

  const remote_message = {
    id: "msg_remote_images",
    role: "assistant",
    parts: [
      {
        type: "file",
        mediaType: "image/png",
        url: "https://storage.example.com/first.png",
      },
      {
        type: "file",
        mediaType: "image/webp",
        url: "https://storage.example.com/second.webp",
      },
    ],
  };
  const plugin = create_image_plugin({
    image_create: () => ({ job_id: "img_remote", status: "queued" }),
    image_result: () => ({
      job_id: "img_remote",
      status: "succeeded",
      result: remote_message,
    }),
  });

  const result = await plugin.actions.image_result.execute({
    context: create_context(workspace_path),
    input: { job_id: "img_remote" },
    plugin_name: "image",
    action_name: "image_result",
  });

  assert.equal(result.success, true);
  assert.deepEqual(result.data.result.parts.map((part) => part.url), [
    path.join(workspace_path, "agent-workspace-data", "image", "results", "img_remote", "image_01.png"),
    path.join(workspace_path, "agent-workspace-data", "image", "results", "img_remote", "image_02.webp"),
  ]);
  assert.deepEqual(
    result.data.result.parts.map((part) => part.providerMetadata.downcity.source_url),
    remote_message.parts.map((part) => part.url),
  );
  assert.equal(
    await fs.readFile(result.data.result.parts[0].url, "utf8"),
    "png-bytes",
  );
  assert.equal(
    await fs.readFile(result.data.result.parts[1].url, "utf8"),
    "webp-bytes",
  );
  assert.deepEqual(result.messages[0].parts, result.data.result.parts);
});

test("ImagePlugin image_result keeps remote URL when local storage fails", async (t) => {
  const workspace_path = await fs.mkdtemp(path.join(os.tmpdir(), "image-plugin-fallback-"));
  t.after(() => fs.rm(workspace_path, { recursive: true, force: true }));
  t.mock.method(globalThis, "fetch", async () => {
    return new Response("unavailable", { status: 503 });
  });
  const remote_url = "https://storage.example.com/failed.png";
  const plugin = create_image_plugin({
    image_create: () => ({ job_id: "img_fallback", status: "queued" }),
    image_result: () => ({
      job_id: "img_fallback",
      status: "succeeded",
      result: {
        id: "msg_remote_fallback",
        role: "assistant",
        parts: [{ type: "file", mediaType: "image/png", url: remote_url }],
      },
    }),
  });

  const result = await plugin.actions.image_result.execute({
    context: create_context(workspace_path),
    input: { job_id: "img_fallback" },
    plugin_name: "image",
    action_name: "image_result",
  });

  assert.equal(result.success, true);
  assert.equal(result.data.result.parts[0].url, remote_url);
  assert.equal(
    result.data.result.parts[0].providerMetadata.downcity.source_url,
    remote_url,
  );
  assert.match(
    result.data.result.parts[0].providerMetadata.downcity.localization_error,
    /HTTP 503/,
  );
  assert.match(result.message, /kept as remote URLs/);
  assert.deepEqual(result.messages[0].parts, result.data.result.parts);
});

test("ImagePlugin image_result reports failed terminal job", async () => {
  const plugin = create_image_plugin({
    image_create: () => ({ job_id: "img_1", status: "queued", poll_after_ms: 1 }),
    image_result: (input) => ({
      job_id: input.job_id,
      status: "failed",
      error: "provider failed",
      poll_after_ms: 1,
    }),
  });

  const result = await plugin.actions.image_result.execute({
    context: create_context(),
    input: { job_id: "img_1" },
    plugin_name: "image",
    action_name: "image_result",
  });

  assert.equal(result.success, false);
  assert.match(result.error, /provider failed/);
  assert.equal(result.data.job_id, "img_1");
});

test("ImagePlugin image_result payload is schema validated by registry", async () => {
  const plugin = create_image_plugin({
    image_create: () => ({ job_id: "img_1", status: "queued", poll_after_ms: 1 }),
    image_result: () => ({ job_id: "img_1", status: "queued", poll_after_ms: 1 }),
  });
  const registry = create_registry(plugin);

  const result = await registry.run_action({
    plugin: "image",
    action: "image_result",
    payload: {},
  });

  assert.equal(result.success, false);
  assert.match(result.error, /Invalid payload/);
});

test("ImagePlugin image_create converts local content image paths", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "downcity-image-plugin-content-"));
  try {
    await fs.writeFile(path.join(tempDir, "input.png"), Buffer.from("png"));
    let captured_input;
    const plugin = create_image_plugin({
      image_create: (input) => {
        captured_input = input;
        return { job_id: "img_1", status: "queued", poll_after_ms: 1 };
      },
      image_result: () => ({ job_id: "img_1", status: "queued", poll_after_ms: 1 }),
    });

    const result = await plugin.actions.image_create.execute({
      context: create_context(tempDir),
      input: {
        content: [
          { type: "text", text: "change background" },
          { type: "image", url: "./input.png" },
        ],
      },
      plugin_name: "image",
      action_name: "image_create",
    });

    assert.equal(result.success, true);
    assert.equal(captured_input.messages[0].content[0].text, "change background");
    assert.match(captured_input.messages[0].content[1].data_url, /^data:image\/png;base64,/);
    assert.equal(captured_input.messages[0].content[1].media_type, "image/png");
    assert.equal("content" in captured_input, false);
    assert.equal("prompt" in captured_input, false);
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test("ImagePlugin image_create uses content instead of prompt when both exist", async () => {
  let captured_input;
  const plugin = create_image_plugin({
    image_create: (input) => {
      captured_input = input;
      return { job_id: "img_1", status: "queued", poll_after_ms: 1 };
    },
    image_result: () => ({ job_id: "img_1", status: "queued", poll_after_ms: 1 }),
  });

  const result = await plugin.actions.image_create.execute({
    context: create_context(),
    input: {
      prompt: "ignore this prompt",
      content: [{ type: "text", text: "use this content" }],
    },
    plugin_name: "image",
    action_name: "image_create",
  });

  assert.equal(result.success, true);
  assert.equal(captured_input.messages[0].content[0].text, "use this content");
  assert.equal("prompt" in captured_input, false);
});

test("ImagePlugin image_create keeps remote content image URLs", async () => {
  let captured_input;
  const plugin = create_image_plugin({
    image_create: (input) => {
      captured_input = input;
      return { job_id: "img_1", status: "queued", poll_after_ms: 1 };
    },
    image_result: () => ({ job_id: "img_1", status: "queued", poll_after_ms: 1 }),
  });

  const result = await plugin.actions.image_create.execute({
    context: create_context(),
    input: {
      content: [
        { type: "text", text: "use this style" },
        { type: "image", url: "https://example.com/input.webp", media_type: "image/webp" },
      ],
    },
    plugin_name: "image",
    action_name: "image_create",
  });

  assert.equal(result.success, true);
  assert.equal(captured_input.messages[0].content[1].url, "https://example.com/input.webp");
  assert.equal(captured_input.messages[0].content[1].media_type, "image/webp");
});

test("ImagePlugin image_create rejects legacy messages and data URLs", async () => {
  const plugin = create_image_plugin({
    image_create: () => ({ job_id: "img_1", status: "queued", poll_after_ms: 1 }),
    image_result: () => ({ job_id: "img_1", status: "queued", poll_after_ms: 1 }),
  });

  const messages_result = await plugin.actions.image_create.execute({
    context: create_context(),
    input: {
      messages: [
        {
          role: "user",
          content: [{ type: "text", text: "legacy" }],
        },
      ],
    },
    plugin_name: "image",
    action_name: "image_create",
  });

  assert.equal(messages_result.success, false);
  assert.match(messages_result.error, /messages is not supported/);

  const data_url_result = await plugin.actions.image_create.execute({
    context: create_context(),
    input: {
      content: [
        { type: "text", text: "edit this" },
        { type: "image", url: "data:image/png;base64,cG5n" },
      ],
    },
    plugin_name: "image",
    action_name: "image_create",
  });

  assert.equal(data_url_result.success, false);
  assert.match(data_url_result.error, /does not accept data URLs/);
});

test("ImagePlugin image_result polls until terminal when until_done=true", async () => {
  const calls = [];
  let next_status = "running";
  const message = create_image_message();
  const plugin = create_image_plugin({
    image_create: () => ({ job_id: "img_wait", status: "queued", poll_after_ms: 1 }),
    image_result: (input) => {
      calls.push(input.job_id);
      if (calls.length >= 3) {
        next_status = "succeeded";
      }
      if (next_status === "succeeded") {
        return {
          job_id: input.job_id,
          status: "succeeded",
          result: message,
          poll_after_ms: 1,
        };
      }
      return {
        job_id: input.job_id,
        status: "running",
        message: "still going",
        poll_after_ms: 1,
      };
    },
  });

  const result = await plugin.actions.image_result.execute({
    context: create_context(),
    input: {
      job_id: "img_wait",
      until_done: true,
      max_wait_ms: 500,
      poll_interval_ms: 5,
    },
    plugin_name: "image",
    action_name: "image_result",
  });

  assert.equal(result.success, true);
  assert.equal(result.data.status, "succeeded");
  assert.deepEqual(result.messages, [{
    role: "assistant",
    parts: message.parts,
  }]);
  assert.ok(calls.length >= 3);
});

test("ImagePlugin image_result returns last status when max_wait_ms elapses", async () => {
  const plugin = create_image_plugin({
    image_create: () => ({ job_id: "img_timeout", status: "queued", poll_after_ms: 1 }),
    image_result: (input) => ({
      job_id: input.job_id,
      status: "running",
      message: "always pending",
      poll_after_ms: 1,
    }),
  });

  const result = await plugin.actions.image_result.execute({
    context: create_context(),
    input: {
      job_id: "img_timeout",
      until_done: true,
      max_wait_ms: 30,
      poll_interval_ms: 5,
    },
    plugin_name: "image",
    action_name: "image_result",
  });

  assert.equal(result.success, true);
  assert.equal(result.data.status, "running");
  assert.equal(result.data.message, "always pending");
});
