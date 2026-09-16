/**
 * 验证 City Tool 的装配、分发、可见性与路径边界判定。
 *
 * 关键点（中文）
 * - 用真实 City/Agent/Workspace 装配，只把沙箱自省替换为测试 Shell。
 * - 断言范围是模型可见契约：描述、索引、成功数据与错误码。
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

/** 单次 city tool 调用绑定的 Session Turn 上下文。 */
const turn_context = {
  session: { session_id: "session-1", turn_id: "turn-1", origin: { type: "chat" } },
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

/** 调用一次 city tool，并携带显式 Session Turn 上下文。 */
async function call_city_tool(tool, input) {
  return await tool.execute(input, {
    tool_call_id: "call-1",
    messages: [],
    context: { session_turn_context: turn_context },
  });
}

/** 创建一套 City、Agent 与 Workspace，并返回 city tool。 */
async function create_city_tool_fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "downcity-city-tool-"));
  const agent = create_test_agent("test-agent");
  const workspace = await create_test_workspace(root, "test-workspace");
  const city = new City({ workspaces: [workspace] });
  city.agents.add(agent);
  const tool = city.get_session_tools(agent.id, workspace).city;
  assert.ok(tool, "city tool should be assembled for every Agent/Workspace");
  return {
    root,
    agent,
    workspace,
    city,
    tool,
    close: async () => {
      await city.close();
      await workspace.dispose();
      await fs.rm(root, { recursive: true, force: true });
    },
  };
}

test("city tool 从注册表派生描述并回答 namespace 与动作索引", async () => {
  const fixture = await create_city_tool_fixture();
  try {
    for (const namespace of ["env", "sandbox", "workspaces", "agent", "usage"]) {
      assert.match(fixture.tool.description, new RegExp(`- ${namespace}: `, "u"));
    }
    const index = await call_city_tool(fixture.tool, {});
    assert.equal(index.ok, true);
    assert.equal(index.namespace, null);
    assert.deepEqual(
      index.data.namespaces.map((item) => item.namespace),
      ["env", "sandbox", "workspaces", "agent", "usage"],
    );
    const namespace_index = await call_city_tool(fixture.tool, { namespace: "sandbox" });
    assert.equal(namespace_index.action, null);
    assert.deepEqual(
      namespace_index.data.actions.map((item) => item.action),
      ["get", "list_mounts", "explain_path"],
    );
    const explain_arg_specs = namespace_index.data.actions[2].args;
    assert.equal(explain_arg_specs.length, 1);
    assert.equal(explain_arg_specs[0].name, "path");
    assert.equal(explain_arg_specs[0].type, "string");
    assert.equal(explain_arg_specs[0].required, true);
    const unknown = await call_city_tool(fixture.tool, { namespace: "secret" });
    assert.equal(unknown.ok, false);
    assert.equal(unknown.error.code, "not_found");
  } finally {
    await fixture.close();
  }
});

test("city tool env 返回当前 Agent、Session 与 Workspace 事实", async () => {
  const fixture = await create_city_tool_fixture();
  try {
    const env = await call_city_tool(fixture.tool, { namespace: "env", action: "get" });
    assert.equal(env.ok, true);
    assert.equal(env.namespace, "env");
    assert.equal(env.action, "get");
    assert.equal(env.data.agent_id, "test-agent");
    assert.equal(env.data.session_id, "session-1");
    assert.equal(env.data.turn_id, "turn-1");
    assert.equal(env.data.workspace_id, "test-workspace");
    assert.equal(env.data.workspace_path, fixture.workspace.path);
    assert.equal(env.data.model_id, "test-model");
    assert.match(env.data.now, /^\d{4}-\d{2}-\d{2}T/u);
    assert.match(env.data.current_date, /^\d{4}-\d{2}-\d{2}$/u);
    const unknown_args = await call_city_tool(fixture.tool, {
      namespace: "env",
      action: "get",
      args: { keys: ["agent_id"] },
    });
    assert.equal(unknown_args.ok, false);
    assert.equal(unknown_args.error.code, "invalid_args");
  } finally {
    await fixture.close();
  }
});

test("city tool 回答沙箱事实并按 Workspace 边界判定路径", async () => {
  const fixture = await create_city_tool_fixture();
  try {
    const sandbox = await call_city_tool(fixture.tool, { namespace: "sandbox", action: "get" });
    assert.equal(sandbox.data.backend, "test-backend");
    assert.equal(sandbox.data.sandbox_id, "test-sandbox");
    assert.equal(sandbox.data.workdir, GUEST_WORKSPACE_PATH);
    assert.equal(sandbox.data.mounts[0].host_path, fixture.workspace.path);
    assert.equal(sandbox.data.persistent, true);

    const inside = await call_city_tool(fixture.tool, {
      namespace: "sandbox",
      action: "explain_path",
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
      namespace: "sandbox",
      action: "explain_path",
      args: { path: path.join(fixture.root, "outside.txt") },
    });
    assert.equal(outside.data.allowed, false);
    assert.equal(outside.data.reason_code, "outside_workspace");
    assert.equal(outside.data.matched_mount, null);
    assert.match(outside.data.reason, /outside the Workspace root/u);

    const guest = await call_city_tool(fixture.tool, {
      namespace: "sandbox",
      action: "explain_path",
      args: { path: `${GUEST_WORKSPACE_PATH}/README.md` },
    });
    assert.equal(guest.data.allowed, true);
    assert.equal(guest.data.resolved_path, path.join(fixture.workspace.path, "README.md"));
    assert.match(guest.data.reason, /mapped to the host path/u);

    const missing_arg = await call_city_tool(fixture.tool, {
      namespace: "sandbox",
      action: "explain_path",
      args: {},
    });
    assert.equal(missing_arg.ok, false);
    assert.equal(missing_arg.error.code, "invalid_args");
  } finally {
    await fixture.close();
  }
});

test("city tool usage 在 bureau 未暴露用户用量前返回 unsupported_action", async () => {
  const fixture = await create_city_tool_fixture();
  try {
    const usage = await call_city_tool(fixture.tool, {
      namespace: "usage",
      action: "get",
      args: { scope: "month" },
    });
    assert.equal(usage.ok, false);
    assert.equal(usage.error.code, "unsupported_action");
    const bad_scope = await call_city_tool(fixture.tool, {
      namespace: "usage",
      action: "get",
      args: { scope: "year" },
    });
    assert.equal(bad_scope.error.code, "invalid_args");
  } finally {
    await fixture.close();
  }
});

test("city tool 在 Workspace 没有 Shell 时明确回答沙箱不可用", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "downcity-city-tool-noshell-"));
  const workspace_path = path.join(root, "no-shell");
  await fs.mkdir(workspace_path, { recursive: true });
  const workspace = new Workspace({ id: "no-shell", path: workspace_path });
  const agent = create_test_agent("no-shell-agent");
  const city = new City({ workspaces: [workspace] });
  city.agents.add(agent);
  try {
    const tool = city.get_session_tools(agent.id, workspace).city;
    const sandbox = await call_city_tool(tool, { namespace: "sandbox", action: "get" });
    assert.equal(sandbox.data.available, false);
    assert.equal(sandbox.data.backend, null);
    assert.deepEqual(sandbox.data.mounts, []);
    const explain = await call_city_tool(tool, {
      namespace: "sandbox",
      action: "explain_path",
      args: { path: "src" },
    });
    assert.equal(explain.data.allowed, true);
    assert.equal(explain.data.matched_mount, null);
  } finally {
    await city.close();
    await workspace.dispose();
    await fs.rm(root, { recursive: true, force: true });
  }
});
