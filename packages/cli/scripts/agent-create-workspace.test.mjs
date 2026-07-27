/**
 * `city agent create` Workspace 参数与交互选择回归测试。
 */

import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

import { resolve_agent_create_workspace } from "../bin/city/agent/create/AgentCreateWorkspace.js";

/** 创建不会意外调用系统窗口的默认测试依赖。 */
function create_input(overrides = {}) {
  return {
    current_directory: "/workspace/current",
    interactive: true,
    select_mode: async () => {
      throw new Error("select_mode should not be called");
    },
    pick_directory: async () => {
      throw new Error("pick_directory should not be called");
    },
    ...overrides,
  };
}

test("显式点路径直接使用当前目录且不进入交互流程", async () => {
  const result = await resolve_agent_create_workspace(create_input({
    path_argument: ".",
  }));
  assert.equal(result, path.resolve("/workspace/current"));
});

test("显式相对路径基于当前目录解析", async () => {
  const result = await resolve_agent_create_workspace(create_input({
    path_argument: "../another-project",
  }));
  assert.equal(result, path.resolve("/workspace/another-project"));
});

test("显式绝对路径保持目标语义", async () => {
  const result = await resolve_agent_create_workspace(create_input({
    path_argument: "/projects/agent-workspace",
  }));
  assert.equal(result, path.resolve("/projects/agent-workspace"));
});

test("无路径参数时可以选择当前目录", async () => {
  const result = await resolve_agent_create_workspace(create_input({
    select_mode: async () => "current",
  }));
  assert.equal(result, path.resolve("/workspace/current"));
});

test("无路径参数时可以通过系统窗口选择其他目录", async () => {
  let picker_initial_directory = "";
  const result = await resolve_agent_create_workspace(create_input({
    select_mode: async () => "choose",
    pick_directory: async (initial_directory) => {
      picker_initial_directory = initial_directory;
      return "/projects/picked-workspace";
    },
  }));
  assert.equal(picker_initial_directory, path.resolve("/workspace/current"));
  assert.equal(result, path.resolve("/projects/picked-workspace"));
});

test("取消交互菜单或系统窗口不会创建 Agent", async () => {
  assert.equal(await resolve_agent_create_workspace(create_input({
    select_mode: async () => null,
  })), null);
  assert.equal(await resolve_agent_create_workspace(create_input({
    select_mode: async () => "choose",
    pick_directory: async () => null,
  })), null);
});

test("非交互环境缺少路径参数时给出显式用法错误", async () => {
  await assert.rejects(
    resolve_agent_create_workspace(create_input({
      interactive: false,
    })),
    /interactive terminal/i,
  );
});
