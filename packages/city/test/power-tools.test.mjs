/**
 * @file 验证 Power 工具层的 ActionResult 转换与调用环境注入。
 *
 * 关键点（中文）
 * - 每个 power 注册为一个工具；工具输入只有 `{ action, args }`。
 * - 省略 action 返回动作索引，替代此前的独立 metadata 读取工具。
 * - 工具直接持有 power 定义与上下文工厂，执行时不经过 Registry 二次解析。
 * - action 的 messages 与 output 分开返回，由 Executor 的统一边界分流。
 */

import test from "node:test";
import assert from "node:assert/strict";
import { power_tool_input_schema } from "../bin/power/tool/PowerToolSchemas.js";
import { create_action } from "@downcity/city/power";
import {
  create_test_power as create_power,
  create_test_power_context,
} from "./helpers/CityPowerTestBinding.mjs";

/** 创建一次调用使用的工具调用环境。 */
function create_call_context(workspace_path = process.cwd()) {
  return {
    agent_id: "power_tools_agent",
    agent_name: "power_tools_agent",
    agent_description: "",
    agent_instructions: [],
    session_id: "session_test",
    session_origin: { type: "chat" },
    turn_id: "turn_test",
    tool_call_id: "call_test",
    messages: [],
  };
}

/** 创建绑定测试 PowerContext 的容器运行时端口替身。 */
function create_host() {
  const context_for = (_power_id, site) => create_test_power_context({
    agent_id: site.agent_id,
    workspace_id: "power_tools_workspace",
    workspace_path: process.cwd(),
  });
  return {
    context_for,
    powers_for: () => ({
      get: () => null,
      snapshots: () => [],
      run_action: async () => ({ success: true }),
      pipeline: async (_point, value) => value,
      effect: async () => {},
    }),
    get_power: () => null,
    snapshots: () => [],
    run_action: async () => ({ success: true }),
    pipeline: async (_point, value) => value,
    effect: async () => {},
  };
}

test("power tool input schema 只暴露 action 与开放 args", async () => {
  assert.equal(power_tool_input_schema.type, "object");
  assert.equal(power_tool_input_schema.additionalProperties, false);
  assert.deepEqual(Object.keys(power_tool_input_schema.properties).sort(), ["action", "args"]);
  const args_schema = power_tool_input_schema.properties.args;
  assert.equal(args_schema.type, "object");
  assert.equal(args_schema.additionalProperties, true);
  assert.deepEqual(args_schema.default, {});
});

test("每个 power 生成一个以 power 名命名的工具，并派生动作描述", async () => {
  const power = create_power({
    name: "catalog",
    title: "Catalog",
    description: "Catalog power.",
    actions: {
      "env.get": create_action({ description: "Read env.", returns: "{ a }", execute: async () => ({ success: true }) }),
      "env.list": create_action({ description: "List env.", returns: "{ b }", execute: async () => ({ success: true }) }),
    },
  });
  const tools = { [power.name]: power.compile_tool(create_host()) };
  assert.deepEqual(Object.keys(tools), ["catalog"]);
  assert.match(tools.catalog.description, /- env\.get: Read env\./u);
  assert.match(tools.catalog.description, /- env\.list: List env\./u);
});

test("没有动作的 power 不产生空壳工具", async () => {
  const power = create_power({
    name: "empty",
    title: "Empty",
    description: "No actions.",
    actions: {},
  });
  assert.equal(power.compile_tool(create_host()), null);
});

test("工具省略 action 时返回动作索引，包含 access 与 returns", async () => {
  const power = create_power({
    name: "indexed",
    title: "Indexed",
    description: "Indexed power.",
    actions: {
      search: create_action({
        description: "Search things.",
        returns: "{ hits }",
        access: "read",
        execute: async () => ({ success: true }),
      }),
      remember: create_action({
        description: "Store a thing.",
        returns: "{ id }",
        access: "write",
        execute: async () => ({ success: true }),
      }),
    },
  });
  const tool = power.compile_tool(create_host());
  const result = await tool.execute({}, create_call_context());
  assert.equal(result.output.success, true);
  assert.equal(result.output.action, null);
  assert.equal(result.output.data.power, "indexed");
  const actions = result.output.data.actions;
  assert.deepEqual(actions.map((item) => item.action), ["remember", "search"]);
  const search = actions.find((item) => item.action === "search");
  assert.equal(search.access, "read");
  assert.equal(search.returns, "{ hits }");
});

test("power action 的 messages 原样交给统一 Tool Result 边界", async () => {
  const power = create_power({
    name: "messaging",
    title: "Messaging",
    description: "Messaging power.",
    actions: {
      emit: create_action({
        description: "Emit content.",
        returns: "{ ok }",
        execute: async () => ({
          success: true,
          data: { ok: true },
          messages: [{
            role: "agent",
            parts: [{ part_id: "p1", sequence: 1, type: "text", text: "from action" }],
          }],
        }),
      }),
    },
  });
  const tool = power.compile_tool(create_host());
  const result = await tool.execute({ action: "emit", args: { text: "hi" } }, create_call_context());
  assert.equal(result.output.success, true);
  assert.deepEqual(result.output.data, { ok: true });
  assert.equal(result.messages.length, 1);
  assert.equal(result.messages[0].role, "agent");
});

test("未知动作返回可读失败而不是抛错", async () => {
  const power = create_power({
    name: "narrow",
    title: "Narrow",
    description: "Narrow power.",
    actions: {
      only: create_action({ description: "Only.", returns: "{}", execute: async () => ({ success: true }) }),
    },
  });
  const tool = power.compile_tool(create_host());
  const result = await tool.execute({ action: "absent" }, create_call_context());
  assert.equal(result.output.success, false);
  assert.match(result.output.error, /does not implement action/u);
});
