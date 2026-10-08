/**
 * 验证 City 三个领域 power 的工具装配、动作索引与数据分发。
 *
 * 关键点（中文）
 * - 用真实 City/Agent/Workspace 装配，只把沙箱自省替换为测试 Shell。
 * - 断言范围是模型可见契约：工具名、点号动作 id、索引、成功数据与错误。
 * - 动作 id 是 `组名.动作名`，与所属 power 名无关；这里同时固定两件事：
 *   三个 power 的划分，以及拆分前后动作 id 不变。
 * - 领域 power 与其它 power 走同一条注册路径，因此这里也覆盖「以 power 名命名工具」这条不变量。
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

/** City 自有的三个领域 power 及其动作 id；动作 id 与拆分前完全一致。 */
const CITY_POWER_ACTIONS = {
  context: [
    "env.get",
    "sandbox.explain_path",
    "sandbox.get",
    "sandbox.list_mounts",
    "usage.get",
    "workspaces.get",
    "workspaces.list",
  ],
  ai: [
    "image.create",
    "image.models",
    "image.result",
    "sound.asr",
    "sound.models",
    "sound.tts",
  ],
  agent: ["agent.get", "agent.list"],
};

/**
 * 单次 city 调用绑定的工具调用环境。
 *
 * 工具层直接接收 `ToolCallContext`；City 侧句柄由上下文工厂补齐。
 * `session_id` 由夹具创建真实 Session 后回填，因为动作执行时会用它解析句柄。
 */
let tool_call_context = {
  agent_id: "test-agent",
  agent_name: "test-agent",
  agent_description: "",
  agent_instructions: [],
  session_id: "",
  session_origin: { type: "work" },
  turn_id: "turn-1",
};

/** 当前测试用例使用的 Workspace；City 用它解析一次调用的执行作用域。 */
let current_workspace;

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
 * 调用一次领域 power 工具，并携带显式调用环境。
 *
 * 工具按 AgentTool 协议返回 `ActionResult`，其中 `output` 才是模型侧结果；
 * messages / effects 由 Executor 分流，这里只断言 output。
 */
async function call_city_tool(tool, input) {
  const result = await tool.execute(input, {
    ...tool_call_context,
    ...(current_workspace ? { workspace: current_workspace } : {}),
  });
  return result.output;
}

/** 创建一套 City、Agent 与 Workspace，并返回三个领域 power 工具。 */
async function create_city_tool_fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "downcity-city-power-"));
  const agent = create_test_agent("test-agent");
  const workspace = await create_test_workspace(root, "test-workspace");
  current_workspace = workspace;
  const city = new City({ workspaces: [workspace] });
  city.agents.add(agent);
  // power 注册是异步 lifecycle；这里等它稳定后读取 Agent 持有的编译产物。
  await city.powers.settled();
  // 动作执行时会用调用环境里的 session_id 解析真实 Session 句柄，
  // 因此夹具必须创建真实 Session，并把它的标识回填到调用环境。
  const session = await agent.sessions.create({ workspace });
  tool_call_context = { ...tool_call_context, session_id: session.id };
  const tools = city.power_tools;
  assert.ok(tools.context, "context power should be assembled for every Agent/Workspace");
  return {
    root,
    agent,
    workspace,
    city,
    session,
    tools,
    close: async () => {
      await city.close();
      await workspace.dispose();
      await fs.rm(root, { recursive: true, force: true });
    },
  };
}

test("三个领域 power 各自以 power 名注册工具，并从动作自描述派生描述与索引", async () => {
  const fixture = await create_city_tool_fixture();
  try {
    // 工具名即 power 名；动作 id 仍是 `组名.动作名`，与所属 power 名无关。
    for (const power_name of Object.keys(CITY_POWER_ACTIONS)) {
      const tool = fixture.tools[power_name];
      assert.ok(tool, `missing tool for power: ${power_name}`);

      const index = await call_city_tool(tool, {});
      assert.equal(index.success, true);
      assert.equal(index.power, power_name);
      assert.equal(index.action, null);
      const action_ids = index.data.actions.map((item) => item.action);
      assert.deepEqual(action_ids, CITY_POWER_ACTIONS[power_name]);

      for (const item of index.data.actions) {
        assert.ok(String(item.description || "").trim(), `missing description: ${item.action}`);
        assert.ok(String(item.returns || "").trim(), `missing returns: ${item.action}`);
        assert.ok(item.access === "read" || item.access === "write", `bad access: ${item.action}`);
        // 描述里逐条列出动作 id，模型无需先发现就能直接调用。
        assert.match(tool.description, new RegExp(`- ${item.action}: `, "u"));
      }

      const unknown = await call_city_tool(tool, { action: "secret.get" });
      assert.equal(unknown.success, false);
      assert.match(unknown.error, /does not implement action/u);
    }
  } finally {
    await fixture.close();
  }
});

test("动作 id 按组前缀归属，与所属 power 名解耦", async () => {
  const fixture = await create_city_tool_fixture();
  try {
    // `env.get` 属于 context power，而不是某个叫 env 的 power。
    assert.equal(fixture.tools.env, undefined);
    assert.equal(fixture.tools.image, undefined);
    assert.equal(fixture.tools.sound, undefined);
    assert.equal(fixture.tools.city, undefined);

    const env = await call_city_tool(fixture.tools.context, { action: "env.get" });
    assert.equal(env.success, true);
    assert.equal(env.power, "context");
    assert.equal(env.action, "env.get");

    // 同一个 power 内的组互不干扰：image 与 sound 都归 ai。
    const models = await call_city_tool(fixture.tools.ai, { action: "image.models" });
    assert.equal(models.power, "ai");
    assert.equal(models.action, "image.models");
  } finally {
    await fixture.close();
  }
});

test("context power env.get 返回当前 Agent、Session 与 Workspace 事实", async () => {
  const fixture = await create_city_tool_fixture();
  try {
    const env = await call_city_tool(fixture.tools.context, { action: "env.get" });
    assert.equal(env.success, true);
    assert.equal(env.action, "env.get");
    assert.equal(env.data.agent_id, "test-agent");
    assert.equal(env.data.session_id, fixture.session.id);
    assert.equal(env.data.turn_id, "turn-1");
    assert.equal(env.data.workspace_id, "test-workspace");
    assert.equal(env.data.workspace_path, fixture.workspace.path);
    assert.equal(env.data.model_id, "test-model");
    assert.match(env.data.now, /^\d{4}-\d{2}-\d{2}T/u);
    assert.match(env.data.current_date, /^\d{4}-\d{2}-\d{2}$/u);

    const unknown_args = await call_city_tool(fixture.tools.context, {
      action: "env.get",
      args: { keys: ["agent_id"] },
    });
    assert.equal(unknown_args.success, false);
    assert.match(unknown_args.error, /does not accept/u);
  } finally {
    await fixture.close();
  }
});

test("context power sandbox 动作回答沙箱事实并按 Workspace 边界判定路径", async () => {
  const fixture = await create_city_tool_fixture();
  try {
    const sandbox = await call_city_tool(fixture.tools.context, { action: "sandbox.get" });
    assert.equal(sandbox.data.backend, "test-backend");
    assert.equal(sandbox.data.sandbox_id, "test-sandbox");
    assert.equal(sandbox.data.workdir, GUEST_WORKSPACE_PATH);
    assert.equal(sandbox.data.mounts[0].host_path, fixture.workspace.path);
    assert.equal(sandbox.data.persistent, true);

    const mounts = await call_city_tool(fixture.tools.context, { action: "sandbox.list_mounts" });
    assert.equal(mounts.data.mounts.length, 1);

    const inside = await call_city_tool(fixture.tools.context, {
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

    const outside = await call_city_tool(fixture.tools.context, {
      action: "sandbox.explain_path",
      args: { path: path.join(fixture.root, "outside.txt") },
    });
    assert.equal(outside.data.allowed, false);
    assert.equal(outside.data.reason_code, "outside_workspace");
    assert.equal(outside.data.matched_mount, null);

    const guest = await call_city_tool(fixture.tools.context, {
      action: "sandbox.explain_path",
      args: { path: `${GUEST_WORKSPACE_PATH}/README.md` },
    });
    assert.equal(guest.data.allowed, true);
    assert.equal(guest.data.resolved_path, path.join(fixture.workspace.path, "README.md"));
    assert.match(guest.data.reason, /mapped to the host path/u);

    const missing_arg = await call_city_tool(fixture.tools.context, {
      action: "sandbox.explain_path",
      args: {},
    });
    assert.equal(missing_arg.success, false);
    assert.match(missing_arg.error, /Invalid payload for context\.sandbox\.explain_path/u);

    const unknown_arg = await call_city_tool(fixture.tools.context, {
      action: "sandbox.explain_path",
      args: { path: "a", extra: "b" },
    });
    assert.equal(unknown_arg.success, false);
    assert.match(unknown_arg.error, /Invalid payload for context\.sandbox\.explain_path/u);
  } finally {
    await fixture.close();
  }
});

test("context power usage.get 在 bureau 未暴露用户用量前明确失败", async () => {
  const fixture = await create_city_tool_fixture();
  try {
    const usage = await call_city_tool(fixture.tools.context, {
      action: "usage.get",
      args: { scope: "month" },
    });
    assert.equal(usage.success, false);
    assert.match(usage.error, /not available yet/u);

    const bad_scope = await call_city_tool(fixture.tools.context, {
      action: "usage.get",
      args: { scope: "year" },
    });
    assert.equal(bad_scope.success, false);
    assert.match(bad_scope.error, /Invalid payload for context\.usage\.get/u);
  } finally {
    await fixture.close();
  }
});

test("agent power 只列出当前 City 的 Agent，并在找不到时明确失败", async () => {
  const fixture = await create_city_tool_fixture();
  try {
    const list = await call_city_tool(fixture.tools.agent, { action: "agent.list" });
    assert.equal(list.success, true);
    assert.equal(list.data.agents.length, 1);
    assert.equal(list.data.agents[0].agent_id, "test-agent");
    assert.equal(list.data.agents[0].is_current, true);

    const current = await call_city_tool(fixture.tools.agent, {
      action: "agent.get",
      args: { agent_id: "test-agent" },
    });
    assert.equal(current.data.agent.is_current, true);

    const missing = await call_city_tool(fixture.tools.agent, {
      action: "agent.get",
      args: { agent_id: "ghost-agent" },
    });
    assert.equal(missing.success, false);
    assert.match(missing.error, /not visible in this City/u);
  } finally {
    await fixture.close();
  }
});

test("领域 power 在 Workspace 没有 Shell 时明确回答沙箱不可用", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "downcity-city-power-noshell-"));
  const agent = create_test_agent("no-shell-agent");
  const workspace_path = path.join(root, "no-shell-workspace");
  await fs.mkdir(workspace_path, { recursive: true });
  const workspace = new Workspace({ id: "no-shell-workspace", path: workspace_path });
  current_workspace = workspace;
  const city = new City({ workspaces: [workspace] });
  city.agents.add(agent);
  try {
    await city.powers.settled();
    const session = await agent.sessions.create({ workspace });
    // 调用环境必须携带真实 Agent 身份：容器在执行点用它反查索引。
    tool_call_context = {
      ...tool_call_context,
      agent_id: agent.id,
      agent_name: agent.name,
      session_id: session.id,
    };
    const sandbox = await call_city_tool(city.power_tools.context, { action: "sandbox.get" });
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
