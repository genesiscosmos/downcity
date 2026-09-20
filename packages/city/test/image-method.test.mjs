/**
 * @file 验证 city tool `image` method 的两步式任务协议。
 *
 * 关键点（中文）
 * - 全部能力都在唯一的 `city` 工具里，按 `{ method, action, args }` 调用。
 * - `result` 默认只读一次；`until_done=true` 时在 method 内等待终态。
 * - 成功结果只返回已保存的本地路径，不注入 Agent 消息。
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

/** 创建绑定测试图片服务的 City，并返回其 Agent、Workspace 与 city 工具。 */
async function create_fixture(options = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "downcity-image-method-"));
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
  // power 注册是异步 lifecycle；这里等它稳定后读取 Agent 持有的编译产物。
  await city.powers.settled();
  // 动作执行时会用调用环境里的 session_id 解析真实 Session 句柄，
  // 因此夹具必须创建真实 Session，并把它的标识回填到调用环境。
  const session = await agent.sessions.create({ workspace });
  const tools = agent.get_power_tools();
  return {
    root,
    workspace_path,
    workspace,
    agent,
    session,
    city,
    tools,
    /**
     * 调用一次 city 工具。
     *
     * 关键点（中文）
     * - 只接受 `{ action: "image.create", args }` 形式；工具按 AgentTool 协议
     *   返回 ActionResult，这里只暴露模型侧 output。
     */
    call: async ({ action, args } = {}) => {
      const result = await tools.city.execute(
        args === undefined ? { action } : { action, args },
        {
          agent_id: agent.id,
          agent_name: agent.id,
          agent_description: "",
          agent_instructions: [],
          session_id: session.id,
          session_origin: session.origin,
          workspace,
          turn_id: "turn_test",
          tool_call_id: "call_1",
          messages: [],
          // 测试关注图片行为本身，因此提供一个直接放行的审批入口；
          // 无审批入口时声明 approval 的动作会被拒绝，属于另一条用例。
          interactions: {
            request: async () => {
              throw new Error("image tests do not expect a pending interaction");
            },
            approval: {
              request: async () => ({ approved: true, auto_approved: true }),
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

test("city 只暴露一个工具，image 是其中一个 method", async () => {
  const fixture = await create_fixture({
    image_create: () => ({ job_id: "img_1", status: "queued" }),
    image_result: () => ({ job_id: "img_1", status: "queued" }),
  });
  try {
    assert.deepEqual(Object.keys(fixture.tools).sort(), ["city", "shell"]);
    assert.equal("image_create" in fixture.tools, false);
    const index = await fixture.call({});
    assert.equal(index.success, true);
    assert.ok(
      index.data.actions.some((item) => item.action.startsWith("image.")),
      "image actions appear in the power index",
    );
    const image_actions = index.data.actions.filter((item) => item.action.startsWith("image."));
    assert.deepEqual(
      image_actions.map((item) => item.action),
      ["image.create", "image.models", "image.result"],
    );
    const create_spec = image_actions.find((item) => item.action === "image.create");
    assert.equal(create_spec.access, "write", "create declares that it consumes quota");
    assert.equal(create_spec.returns, "job_id, status, poll_after_ms");
  } finally {
    await fixture.close();
  }
});

test("image method 贡献一段 session system 说明", async () => {
  const fixture = await create_fixture({
    image_create: () => ({ job_id: "img_1", status: "queued" }),
    image_result: () => ({ job_id: "img_1", status: "queued" }),
  });
  try {
    // 公开入口：Agent 按当前扩展产物解析一个 Session 可见的 system messages。
    const messages = await fixture.agent.resolve_system_messages(fixture.workspace, {
      session_id: "s1",
    });
    const image_block = messages.find((message) =>
      String(message.content || "").includes("# Image actions")
    );
    assert.ok(image_block, "city power should inject one system block covering its action groups");
    assert.match(image_block.content, /# Image actions/u);
    assert.match(image_block.content, /explicitly confirm/u);
    assert.match(image_block.content, /# Sound actions/u);
  } finally {
    await fixture.close();
  }
});

test("image create 返回任务并透传 prompt", async () => {
  let received;
  const fixture = await create_fixture({
    image_create: (input) => {
      received = input;
      return { job_id: "img_1", status: "queued", poll_after_ms: 1 };
    },
    image_result: () => ({ job_id: "img_1", status: "queued" }),
  });
  try {
    const result = await fixture.call({ action: "image.create",
      args: { model: "image-model-id", prompt: "a rainy city corner", aspect_ratio: "16:9" },
    });
    assert.equal(result.success, true);
    assert.deepEqual(result.data, { job_id: "img_1", status: "queued", poll_after_ms: 1 });
    assert.equal(received.model, "image-model-id");
    assert.equal(received.prompt, "a rainy city corner");
    assert.equal(received.aspect_ratio, "16:9");
  } finally {
    await fixture.close();
  }
});

test("image models 过滤非图片模型", async () => {
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
    const result = await fixture.call({ action: "image.models" });
    assert.deepEqual(result.data.items.map((item) => item.id), ["img-a", "img-b"]);
  } finally {
    await fixture.close();
  }
});

test("image result 默认只读一次", async () => {
  let reads = 0;
  const fixture = await create_fixture({
    image_create: () => ({ job_id: "img_1", status: "queued" }),
    image_result: () => {
      reads += 1;
      return { job_id: "img_1", status: "running", poll_after_ms: 1 };
    },
  });
  try {
    const result = await fixture.call({ action: "image.result",
      args: { job_id: "img_1" },
    });
    assert.equal(result.data.status, "running");
    assert.equal(reads, 1);
  } finally {
    await fixture.close();
  }
});

test("image result 成功时只返回本地路径", async () => {
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
    const result = await fixture.call({ action: "image.result",
      args: { job_id: "img_remote" },
    });
    assert.equal(result.success, true);
    assert.equal(result.data.status, "succeeded");
    assert.deepEqual(result.data.files, [
      path.join(
        fixture.root,
        "agents",
        "image_agent",
        "powers",
        "image",
        "image",
        "results",
        "img_remote",
        "image_01.png",
      ),
    ]);
    assert.equal(await fs.readFile(result.data.files[0], "utf8"), "image-bytes");
    assert.equal("messages" in result.data, false);
  } finally {
    await fixture.close();
    await new Promise((resolve) => server.close(resolve));
  }
});

test("image result 下载失败时保留远端地址并报告", async () => {
  const fixture = await create_fixture({
    image_create: () => ({ job_id: "img_1", status: "queued" }),
    image_result: () => ({
      job_id: "img_remote",
      status: "succeeded",
      result: create_image_message("http://127.0.0.1:1/result.png"),
    }),
  });
  try {
    const result = await fixture.call({ action: "image.result",
      args: { job_id: "img_remote" },
    });
    assert.deepEqual(result.data.files, ["http://127.0.0.1:1/result.png"]);
    assert.match(result.data.warning, /kept as remote URLs/u);
  } finally {
    await fixture.close();
  }
});

test("image result 失败任务返回错误信封", async () => {
  const fixture = await create_fixture({
    image_create: () => ({ job_id: "img_1", status: "queued" }),
    image_result: () => ({
      job_id: "img_1",
      status: "failed",
      error: "provider rejected the prompt",
    }),
  });
  try {
    const result = await fixture.call({ action: "image.result",
      args: { job_id: "img_1" },
    });
    assert.equal(result.success, false);
    assert.match(result.error, /provider rejected the prompt/u);
  } finally {
    await fixture.close();
  }
});

test("image create 把本地图片转为 data URL", async () => {
  const fixture = await create_fixture({
    image_create: (input) => ({ job_id: "img_1", status: "queued", received: input }),
    image_result: () => ({ job_id: "img_1", status: "queued" }),
  });
  try {
    await fs.writeFile(path.join(fixture.workspace_path, "input.png"), "local-bytes");
    const result = await fixture.call({ action: "image.create",
      args: {
        model: "image-model-id",
        content: [
          { type: "text", text: "make it white" },
          { type: "image", url: "./input.png" },
        ],
      },
    });
    const messages = result.data.received.messages;
    assert.equal(messages.length, 1);
    assert.equal(messages[0].content[0].text, "make it white");
    assert.match(messages[0].content[1].data_url, /^data:image\/png;base64,/u);
    assert.equal("prompt" in result.data.received, false);
  } finally {
    await fixture.close();
  }
});

test("image create 拒绝未声明参数与非法图片地址", async () => {
  const fixture = await create_fixture({
    image_create: () => ({ job_id: "img_1", status: "queued" }),
    image_result: () => ({ job_id: "img_1", status: "queued" }),
  });
  try {
    const unknown = await fixture.call({ action: "image.create",
      args: { model: "m", messages: [{ role: "user" }] },
    });
    assert.equal(unknown.success, false);
    assert.match(unknown.error, /Invalid payload for city\.image\.create/u);

    const data_url = await fixture.call({ action: "image.create",
      args: { model: "m", content: [{ type: "image", url: "data:image/png;base64,AAAA" }] },
    });
    assert.equal(data_url.success, false);
    assert.match(data_url.error, /does not accept data URLs/u);
  } finally {
    await fixture.close();
  }
});

test("image result 在 until_done 时轮询到终态", async () => {
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
    const result = await fixture.call({ action: "image.result",
      args: { job_id: "img_1", until_done: true, max_wait_ms: 5_000, poll_interval_ms: 1 },
    });
    assert.equal(result.data.status, "succeeded");
    assert.equal(reads, 3);
  } finally {
    await fixture.close();
  }
});
