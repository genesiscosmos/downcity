/**
 * 验证 city power 的工具装配、动作索引与数据分发。
 *
 * 关键点（中文）
 * - 用真实 City/Agent/Workspace 装配，只把沙箱自省替换为测试 Shell。
 * - 断言范围是模型可见契约：工具名、点号动作 id、索引、成功数据与错误。
 * - city 与其它 power 走同一条注册路径，因此这里也覆盖「以 power 名命名工具」这条不变量。
 */

import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { Agent } from "@downcity/agent";
import { City, Workspace } from "../bin/index.js";

/** 当前 Workspace 在隔离环境中的固定挂载路径。 */
const GUEST_WORKSPACE_PATH = "/workspace";

/**
 * 单次 city 调用绑定的 Session Turn 上下文。
 *
 * 工具层会从 `step.hook_context()` 取本次调用的执行快照，因此测试必须提供同形结构。
 */
const turn_context = {
  session: { session_id: "session-1", turn_id: "turn-1", origin: { type: "chat" } },
  step: {
    hook_context: () => ({ session_id: "session-1", turn_id: "turn-1" }),
  },
};

/** 创建只提供沙箱自省能力的测试 Shell。 */
function create_test_shell(workspace_path) {
  return {
    tools: {},
    bind: () => {},
    set_env: () => {},
    describe_sandbox: () => ({
      backend: "test-backend",
      sandbox_id: "test-sandbox",
      workdir: GUEST_WORKSPACE_PATH,
      mounts: [
        { host_path: workspace_path, sandbox_path: GUEST_WORKSPACE_PATH, mode: "rw" },
      ],
      persistent: true,
    }),
    run_sandbox_command: async () => {
      throw new Error("unused");
    },
    reset_sandbox: async () => {},
    dispose: async () => {},
  };
}

/** 创建绑定测试 Shell 的临时 Workspace。 */
async function create_test_workspace(root, workspace_id) {
  const workspace_path = path.join(root, workspace_id);
  await fs.mkdir(workspace_path, { recursive: true });
  return new Workspace({
    id: workspace_id,
    name: workspace_id,
    path: workspace_path,
    shell: create_test_shell(workspace_path),
  });
}

/** 创建带模型标识的测试 Agent。 */
function create_test_agent(agent_id) {
  return new Agent({
    id: agent_id,
    name: `${agent_id} name`,
    model: { id: "test-model", stream: async () => { throw new Error("unused"); } },
  });
}

/**
 * 调用一次 city power 工具，并携带显式 Session Turn 上下文。
 *
 * 工具层按 Runtime Tool 协议返回 `ActionResult`，其中 `output` 才是模型侧结果；
 * messages / effects 由 Executor 分流，这里只断言 output。
 */
async function call_city_tool(tool, input) {
  const result = await tool.execute(input, {
    tool_call_id: "call-1",
    messages: [],
    context: { session_turn_context: turn_context },
  });
  return result.output;
}

/** 创建一套 City、Agent 与 Workspace，并返回 city power 工具。 */
async function create_city_tool_fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "downcity-city-power-"));
  const agent = create_test_agent("test-agent");
  const workspace = await create_test_workspace(root, "test-workspace");
  const city = new City({ workspaces: [workspace] });
  city.agents.add(agent);
  // power 注册是异步 lifecycle；执行前必须先等 City ready（Agent 执行路径同此约定）。
  await city.ensure_ready();
  const tools = city.get_session_tools(agent.id, workspace);
  const tool = tools.city;
  assert.ok(tool, "city power should be assembled for every Agent/Workspace");
  return {
    root,
    agent,
    workspace,
    city,
    tool,
    tools,
    close: async () => {
      await city.close();
      await workspace.dispose();
      await fs.rm(root, { recursive: true, force: true });
    },
  };
}

test("city power 以 power 名注册工具，并从动作自描述派生描述与索引", async () => {
  const fixture = await create_city_tool_fixture();
  try {
    // 工具名即 power 名；不含组前缀的动作 id 只出现在索引里。
    assert.ok(Object.prototype.hasOwnProperty.call(fixture.tools, "city"));
    assert.equal(fixture.tools.city, fixture.tool);

    const index = await call_city_tool(fixture.tool, {});
    assert.equal(index.success, true);
    assert.equal(index.power, "city");
    assert.equal(index.action, null);
    const action_ids = index.data.actions.map((item) => item.action);
    assert.deepEqual(action_ids, [
      "agent.get",
      "agent.list",
      "env.get",
      "image.create",
      "image.models",
      "image.result",
      "sandbox.explain_path",
      "sandbox.get",
      "sandbox.list_mounts",
      "sound.asr",
      "sound.models",
      "sound.tts",
      "usage.get",
      "workspaces.get",
      "workspaces.list",
    ]);
    for (const item of index.data.actions) {
      assert.ok(String(item.description || "").trim(), `missing description: ${item.action}`);
      assert.ok(String(item.returns || "").trim(), `missing returns: ${item.action}`);
      assert.ok(item.access === "read" || item.access === "write", `bad access: ${item.action}`);
    }

    // 描述里逐条列出动作 id，模型无需先发现就能直接调用。
    for (const action_id of action_ids) {
      assert.match(fixture.tool.description, new RegExp(`- ${action_id}: `, "u"));
    }

    const unknown = await call_city_tool(fixture.tool, { action: "secret.get" });
    assert.equal(unknown.success, false);
    assert.match(unknown.error, /does not implement action/u);
  } finally {
    await fixture.close();
  }
});

test("city power env.get 返回当前 Agent、Session 与 Workspace 事实", async () => {
  const fixture = await create_city_tool_fixture();
  try {
    const env = await call_city_tool(fixture.tool, { action: "env.get" });
    assert.equal(env.success, true);
    assert.equal(env.action, "env.get");
    assert.equal(env.data.agent_id, "test-agent");
    assert.equal(env.data.session_id, "session-1");
    assert.equal(env.data.turn_id, "turn-1");
    assert.equal(env.data.workspace_id, "test-workspace");
    assert.equal(env.data.workspace_path, fixture.workspace.path);
    assert.equal(env.data.model_id, "test-model");
    assert.match(env.data.now, /^\d{4}-\d{2}-\d{2}T/u);
    assert.match(env.data.current_date, /^\d{4}-\d{2}-\d{2}$/u);

    const unknown_args = await call_city_tool(fixture.tool, {
      action: "env.get",
      args: { keys: ["agent_id"] },
    });
    assert.equal(unknown_args.success, false);
    assert.match(unknown_args.error, /does not accept/u);
  } finally {
    await fixture.close();
  }
});

test("city power sandbox 动作回答沙箱事实并按 Workspace 边界判定路径", async () => {
  const fixture = await create_city_tool_fixture();
  try {
    const sandbox = await call_city_tool(fixture.tool, { action: "sandbox.get" });
    assert.equal(sandbox.data.backend, "test-backend");
    assert.equal(sandbox.data.sandbox_id, "test-sandbox");
    assert.equal(sandbox.data.workdir, GUEST_WORKSPACE_PATH);
    assert.equal(sandbox.data.mounts[0].host_path, fixture.workspace.path);
    assert.equal(sandbox.data.persistent, true);

    const mounts = await call_city_tool(fixture.tool, { action: "sandbox.list_mounts" });
    assert.equal(mounts.data.mounts.length, 1);

    const inside = await call_city_tool(fixture.tool, {
      action: "sandbox.explain_path",
      args: { path: "packages/city/src/index.ts" },
    });
    assert.equal(inside.data.allowed, true);
    assert.equal(inside.data.reason_code, "allowed");
    assert.equal(
      inside.data.resolved_path,
      path.join(fixture.workspace.path, "packages/city/src/index.ts"),
    );
    assert.equal(inside.data.matched_mount.host_path, fixture.workspace.path);

    const outside = await call_city_tool(fixture.tool, {
      action: "sandbox.explain_path",
      args: { path: path.join(fixture.root, "outside.txt") },
    });
    assert.equal(outside.data.allowed, false);
    assert.equal(outside.data.reason_code, "outside_workspace");
    assert.equal(outside.data.matched_mount, null);

    const guest = await call_city_tool(fixture.tool, {
      action: "sandbox.explain_path",
      args: { path: `${GUEST_WORKSPACE_PATH}/README.md` },
    });
    assert.equal(guest.data.allowed, true);
    assert.equal(guest.data.resolved_path, path.join(fixture.workspace.path, "README.md"));
    assert.match(guest.data.reason, /mapped to the host path/u);

    const missing_arg = await call_city_tool(fixture.tool, {
      action: "sandbox.explain_path",
      args: {},
    });
    assert.equal(missing_arg.success, false);
    assert.match(missing_arg.error, /Invalid payload for city\.sandbox\.explain_path/u);

    const unknown_arg = await call_city_tool(fixture.tool, {
      action: "sandbox.explain_path",
      args: { path: "a", extra: "b" },
    });
    assert.equal(unknown_arg.success, false);
    assert.match(unknown_arg.error, /Invalid payload for city\.sandbox\.explain_path/u);
  } finally {
    await fixture.close();
  }
});

test("city power usage.get 在 bureau 未暴露用户用量前明确失败", async () => {
  const fixture = await create_city_tool_fixture();
  try {
    const usage = await call_city_tool(fixture.tool, {
      action: "usage.get",
      args: { scope: "month" },
    });
    assert.equal(usage.success, false);
    assert.match(usage.error, /not available yet/u);

    const bad_scope = await call_city_tool(fixture.tool, {
      action: "usage.get",
      args: { scope: "year" },
    });
    assert.equal(bad_scope.success, false);
    assert.match(bad_scope.error, /Invalid payload for city\.usage\.get/u);
  } finally {
    await fixture.close();
  }
});

test("city power 在 Workspace 没有 Shell 时明确回答沙箱不可用", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "downcity-city-power-noshell-"));
  const agent = create_test_agent("no-shell-agent");
  const workspace_path = path.join(root, "no-shell-workspace");
  await fs.mkdir(workspace_path, { recursive: true });
  const workspace = new Workspace({ id: "no-shell-workspace", path: workspace_path });
  const city = new City({ workspaces: [workspace] });
  city.agents.add(agent);
  try {
    await city.ensure_ready();
    const tool = city.get_session_tools(agent.id, workspace).city;
    const sandbox = await call_city_tool(tool, { action: "sandbox.get" });
    assert.equal(sandbox.success, true);
    assert.equal(sandbox.data.available, false);
    assert.equal(sandbox.data.backend, null);
    assert.deepEqual(sandbox.data.mounts, []);
  } finally {
    await city.close();
    await workspace.dispose();
    await fs.rm(root, { recursive: true, force: true });
  }
});
