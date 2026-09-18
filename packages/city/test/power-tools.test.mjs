/**
 * @file 验证 Power 工具层的 ActionResult 转换与 Session 执行上下文。
 *
 * 关键点（中文）
 * - 每个 power 注册为一个工具；工具输入只有 `{ action, args }`。
 * - 省略 action 返回动作索引，替代此前的独立 metadata 读取工具。
 * - action 的 messages 与 output 分开返回，由 Executor 的统一边界分流。
 */

import test from "node:test";
import assert from "node:assert/strict";
import { invoke_power_tool } from "../bin/power/tool/PowerToolRuntime.js";
import { create_power_tools } from "../bin/power/tool/PowerTools.js";
import { power_tool_input_schema } from "../bin/power/tool/PowerToolSchemas.js";
import { create_action } from "@downcity/city/power";
import { PowerRegistry } from "../bin/power/core/PowerRegistry.js";
import { create_session_turn_context } from "@downcity/agent";
import {
  create_test_power as create_power,
  create_test_power_context,
} from "./helpers/CityPowerTestBinding.mjs";

/** 创建绑定测试 project root 的 Session Turn Context。 */
function create_turn_context(project_root) {
  return create_session_turn_context({
    session_id: "session_test",
    session_origin: { type: "chat" },
    turn_id: "turn_test",
    project_root,
  });
}

/** 创建绑定测试 PowerContext 的 Registry 调用面。 */
function create_registry(power) {
  const registry = new PowerRegistry([power]);
  const context_factory = () => create_test_power_context({
    agent_id: "power_tools_agent",
    workspace_id: "power_tools_workspace",
    workspace_path: process.cwd(),
  });
  return Object.assign(registry.contextual(context_factory), {
    execution_view: () => registry.execution_view(context_factory),
    register: (next_power) => registry.register(next_power),
    unregister: (power_name) => registry.unregister(power_name),
    unregister_and_wait: (power_name) => registry.unregister_and_wait(power_name),
  });
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
  const tools = create_power_tools({
    definitions: [power],
    powers: create_registry(power),
  });
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
  const tools = create_power_tools({
    definitions: [power],
    powers: create_registry(power),
  });
  assert.deepEqual(Object.keys(tools), []);
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
  const context = create_test_power_context({
    agent_id: "power_tools_agent",
    workspace_id: "power_tools_workspace",
    workspace_path: process.cwd(),
  });
  const registry = create_registry(power);
  const result = await invoke_power_tool({
    powers: registry,
    power_name: "indexed",
    turn_context: create_turn_context(process.cwd()),
    call_id: "call_index",
    input: {},
  });
  assert.equal(result.output.success, true);
  assert.equal(result.output.action, null);
  assert.equal(result.output.data.power, "indexed");
  const actions = result.output.data.actions;
  assert.deepEqual(actions.map((item) => item.action), ["remember", "search"]);
  const search = actions.find((item) => item.action === "search");
  assert.equal(search.access, "read");
  assert.equal(search.returns, "{ hits }");
  assert.equal(typeof context.logger, "object");
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
  const registry = create_registry(power);
  const result = await invoke_power_tool({
    powers: registry,
    power_name: "messaging",
    turn_context: create_turn_context(process.cwd()),
    call_id: "call_msg",
    input: { action: "emit", args: { text: "hi" } },
  });
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
  const registry = create_registry(power);
  const result = await invoke_power_tool({
    powers: registry,
    power_name: "narrow",
    turn_context: create_turn_context(process.cwd()),
    call_id: "call_missing",
    input: { action: "absent" },
  });
  assert.equal(result.output.success, false);
  assert.match(result.output.error, /does not implement action/u);
});
