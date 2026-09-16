/**
 * @file 验证 Image capability 的两步式图片任务协议。
 *
 * 关键点（中文）
 * - Capability 向模型暴露 image_models / image_create / image_result 三个一等工具。
 * - image_result 默认只读取一次当前状态；传 until_done=true 时会在 capability 内等待终态。
 * - 成功图片返回已指向本地文件的 Agent Parts，由执行器并入当前回复。
 */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";

import { Agent } from "@downcity/agent";
import { City, LocalStorageProvider, Workspace } from "../bin/index.js";

/** 当前测试注入的图片 AI 服务实现。 */
let current_image_ai;

/** 创建绑定测试图片服务的 City，并返回其 Agent、Workspace 与工具集合。 */
async function create_fixture(options = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "downcity-image-capability-"));
  const workspace_path = path.join(root, "workspace");
  await fs.mkdir(workspace_path, { recursive: true });
  current_image_ai = {
    catalog: async () => ({ all: () => (options.list_models ? options.list_models() : []) }),
    image_create: options.image_create,
    image_result: options.image_result,
  };
  const workspace = new Workspace({ id: "image_workspace", path: workspace_path });
  const agent = new Agent({ id: "image_agent" });
  const city = new City({
    storage: new LocalStorageProvider(root),
    workspaces: [workspace],
    embassy: { user: { ai: current_image_ai } },
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

/** 构造一张成功返回的远端图片消息。 */
function create_image_message(url = "https://storage.example.com/result.png") {
  return {
    id: "msg_image_test",
    role: "agent",
    parts: [
      {
        type: "file",
        media_type: "image/png",
        filename: "image.png",
        url,
      },
    ],
  };
}

test("Image capability 暴露 job 风格的一等工具与 system 说明", async () => {
  const fixture = await create_fixture({
    image_create: () => ({ job_id: "img_1", status: "queued" }),
    image_result: () => ({ job_id: "img_1", status: "queued" }),
  });
  try {
    for (const name of ["image_models", "image_create", "image_result"]) {
      assert.ok(fixture.tools[name], `${name} should be exposed as a first-class tool`);
    }
    assert.equal("plugin_call" in fixture.tools, false);
    const blocks = await fixture.city.get_session_hooks(
      fixture.agent.id,
      fixture.workspace,
    ).system_blocks({ session_id: "s1" });
    const image_block = blocks.find((block) => block.name === "image");
    assert.ok(image_block, "image capability should inject one system block");
    assert.match(image_block.content, /# Image capability/u);
    assert.match(image_block.content, /explicit user confirmation/u);
  } finally {
    await fixture.close();
  }
});

test("Image capability image_create 返回任务并透传 prompt", async () => {
  let received;
  const fixture = await create_fixture({
    image_create: (input) => {
      received = input;
      return { job_id: "img_1", status: "queued", poll_after_ms: 1 };
    },
    image_result: () => ({ job_id: "img_1", status: "queued" }),
  });
  try {
    const result = await call_tool(fixture.tools.image_create, {
      model: "image-model-id",
      prompt: "a rainy city corner",
      aspect_ratio: "16:9",
    });
    assert.deepEqual(result.output, { job_id: "img_1", status: "queued", poll_after_ms: 1 });
    assert.deepEqual(result.messages, []);
    assert.equal(received.model, "image-model-id");
    assert.equal(received.prompt, "a rainy city corner");
    assert.equal(received.aspect_ratio, "16:9");
  } finally {
    await fixture.close();
  }
});

test("Image capability image_models 过滤非图片模型", async () => {
  const fixture = await create_fixture({
    list_models: () => [
      { id: "img-a", name: "Image A", modalities: ["image", "text"] },
      { id: "text-only", name: "Text", modalities: ["text"] },
      { id: "img-b", modalities: ["image"] },
    ],
    image_create: () => ({ job_id: "img_1", status: "queued" }),
    image_result: () => ({ job_id: "img_1", status: "queued" }),
  });
  try {
    const result = await call_tool(fixture.tools.image_models, {});
    assert.deepEqual(result.output.items.map((item) => item.id), ["img-a", "img-b"]);
  } finally {
    await fixture.close();
  }
});

test("Image capability image_result 默认只读一次", async () => {
  let reads = 0;
  const fixture = await create_fixture({
    image_create: () => ({ job_id: "img_1", status: "queued" }),
    image_result: () => {
      reads += 1;
      return { job_id: "img_1", status: "running", poll_after_ms: 1 };
    },
  });
  try {
    const result = await call_tool(fixture.tools.image_result, { job_id: "img_1" });
    assert.equal(result.output.status, "running");
    assert.equal(reads, 1);
  } finally {
    await fixture.close();
  }
});

test("Image capability image_result 成功时返回 Agent Parts", async () => {
  const fixture = await create_fixture({
    image_create: () => ({ job_id: "img_1", status: "queued" }),
    image_result: () => ({
      job_id: "img_1",
      status: "succeeded",
      result: create_image_message("/tmp/result.png"),
    }),
  });
  try {
    const result = await call_tool(fixture.tools.image_result, { job_id: "img_1" });
    assert.equal(result.output.status, "succeeded");
    assert.equal(result.messages.length, 1);
    assert.equal(result.messages[0].role, "agent");
    assert.equal(result.messages[0].parts[0].url, "/tmp/result.png");
  } finally {
    await fixture.close();
  }
});

test("Image capability image_result 失败任务抛错", async () => {
  const fixture = await create_fixture({
    image_create: () => ({ job_id: "img_1", status: "queued" }),
    image_result: () => ({
      job_id: "img_1",
      status: "failed",
      error: "provider rejected the prompt",
    }),
  });
  try {
    await assert.rejects(
      () => call_tool(fixture.tools.image_result, { job_id: "img_1" }),
      /provider rejected the prompt/u,
    );
  } finally {
    await fixture.close();
  }
});

test("Image capability image_result 本地化远端图片", async () => {
  const server = http.createServer((_req, res) => {
    res.writeHead(200, { "content-type": "image/png" });
    res.end("image-bytes");
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  const fixture = await create_fixture({
    image_create: () => ({ job_id: "img_1", status: "queued" }),
    image_result: () => ({
      job_id: "img_remote",
      status: "succeeded",
      result: create_image_message(`http://127.0.0.1:${port}/result.png`),
    }),
  });
  try {
    const result = await call_tool(fixture.tools.image_result, { job_id: "img_remote" });
    const url = result.messages[0].parts[0].url;
    assert.equal(
      url,
      path.join(
        fixture.root,
        "agents",
        "image_agent",
        "capabilities",
        "image",
        "image",
        "results",
        "img_remote",
        "image_01.png",
      ),
    );
    assert.equal(await fs.readFile(url, "utf8"), "image-bytes");
  } finally {
    await fixture.close();
    await new Promise((resolve) => server.close(resolve));
  }
});

test("Image capability image_result 下载失败时保留远程地址并报告", async () => {
  const fixture = await create_fixture({
    image_create: () => ({ job_id: "img_1", status: "queued" }),
    image_result: () => ({
      job_id: "img_remote",
      status: "succeeded",
      result: create_image_message("http://127.0.0.1:1/result.png"),
    }),
  });
  try {
    const result = await call_tool(fixture.tools.image_result, { job_id: "img_remote" });
    assert.equal(result.messages[0].parts[0].url, "http://127.0.0.1:1/result.png");
    assert.match(result.output.warning, /kept as remote URLs/u);
  } finally {
    await fixture.close();
  }
});

test("Image capability image_create 把本地图片转为 data URL", async () => {
  const fixture = await create_fixture({
    image_create: (input) => ({ job_id: "img_1", status: "queued", received: input }),
    image_result: () => ({ job_id: "img_1", status: "queued" }),
  });
  try {
    await fs.writeFile(path.join(fixture.workspace_path, "input.png"), "local-bytes");
    const result = await call_tool(fixture.tools.image_create, {
      model: "image-model-id",
      content: [
        { type: "text", text: "make it white" },
        { type: "image", url: "./input.png" },
      ],
    });
    const messages = result.output.received.messages;
    assert.equal(messages.length, 1);
    assert.equal(messages[0].content[0].text, "make it white");
    assert.match(messages[0].content[1].data_url, /^data:image\/png;base64,/u);
    assert.equal("prompt" in result.output.received, false);
  } finally {
    await fixture.close();
  }
});

test("Image capability image_create 拒绝 messages 与 data URL", async () => {
  const fixture = await create_fixture({
    image_create: () => ({ job_id: "img_1", status: "queued" }),
    image_result: () => ({ job_id: "img_1", status: "queued" }),
  });
  try {
    await assert.rejects(
      () => call_tool(fixture.tools.image_create, { messages: [{ role: "user" }] }),
      /messages is not supported/u,
    );
    await assert.rejects(
      () => call_tool(fixture.tools.image_create, {
        content: [{ type: "image", data_url: "data:image/png;base64,AAAA" }],
      }),
      /data_url is not supported/u,
    );
    await assert.rejects(
      () => call_tool(fixture.tools.image_create, {
        content: [{ type: "image", url: "data:image/png;base64,AAAA" }],
      }),
      /does not accept data URLs/u,
    );
  } finally {
    await fixture.close();
  }
});

test("Image capability image_result 在 until_done 时轮询到终态", async () => {
  let reads = 0;
  const fixture = await create_fixture({
    image_create: () => ({ job_id: "img_1", status: "queued" }),
    image_result: () => {
      reads += 1;
      if (reads < 3) return { job_id: "img_1", status: "running", poll_after_ms: 1 };
      return {
        job_id: "img_1",
        status: "succeeded",
        result: create_image_message("/tmp/result.png"),
      };
    },
  });
  try {
    const result = await call_tool(fixture.tools.image_result, {
      job_id: "img_1",
      until_done: true,
      max_wait_ms: 5_000,
      poll_interval_ms: 1,
    });
    assert.equal(result.output.status, "succeeded");
    assert.equal(reads, 3);
  } finally {
    await fixture.close();
  }
});
