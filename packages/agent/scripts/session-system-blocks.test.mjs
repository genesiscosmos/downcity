/**
 * @file 验证 SDK session system blocks 的稳定分层顺序。
 *
 * 关键点（中文）
 * - 测试编译后的 bin 输出，避免测试文件依赖 TS 源码加载器。
 * - 自定义 instruction 不能替代 Downcity core；core 必须包含 Shell 与 plugin 总规则。
 */

import test from "node:test";
import assert from "node:assert/strict";

import { create_instruction_system_blocks } from "../bin/agent/AgentInstructions.js";
import { build_session_system_blocks } from "../bin/session/SessionSystem.js";

test("instruction blocks keep Downcity core after custom instruction", () => {
  const blocks = create_instruction_system_blocks(
    ["你是这个项目的工程 agent。"],
    "/tmp/downcity-project",
  );

  assert.deepEqual(
    blocks.map((block) => `${block.source}:${block.name}`),
    ["instruction:agent", "core:default"],
  );
  assert.match(blocks[1].content, /# Downcity Agent/);
  assert.match(blocks[1].content, /# Harness Design/);
  assert.match(blocks[1].content, /human-owned workspace/);
  assert.match(blocks[1].content, /project structure is the control surface/);
  assert.match(blocks[1].content, /# Shell Commands/);
  assert.match(blocks[1].content, /# Plugin System/);
  assert.doesNotMatch(blocks[1].content, /\/tmp\/downcity-project/);
  assert.doesNotMatch(blocks[1].content, /current year/i);
  assert.doesNotMatch(blocks[1].content, /# Project Runtime/);
  assert.doesNotMatch(blocks[1].content, /\.downcity\/agents/);
  assert.doesNotMatch(blocks[1].content, /\.downcity\/memory/);
  assert.doesNotMatch(blocks[1].content, /\.downcity\/public/);
});

test("session system blocks are ordered as instruction, core, plugin, session", async () => {
  const blocks = await build_session_system_blocks({
    agent_id: "agent-test",
    project_root: "/tmp/downcity-project",
    session_id: "session-test",
    created_at: Date.UTC(2026, 6, 9, 8, 0, 0),
    timezone: "Asia/Shanghai",
    get_instruction_system_blocks: () =>
      create_instruction_system_blocks(
        ["使用中文回复。"],
        "/tmp/downcity-project",
      ),
    get_managed_plugin_system_blocks: async () => [],
    get_plugin_system_blocks: async () => [
      {
        source: "plugin",
        name: "task",
        content: "# Task Plugin\n\n任务插件说明。",
      },
    ],
  });

  assert.deepEqual(
    blocks.map((block) => `${block.source}:${block.name}`),
    [
      "instruction:agent",
      "core:default",
      "plugin:task",
      "session:context",
    ],
  );
  assert.equal(blocks[0].content, "使用中文回复。");
  assert.match(blocks[1].content, /plugin_call/);
  assert.match(blocks[3].content, /^Current session context:/);
  assert.match(
    blocks[3].content,
    /You are serving agent "agent-test" in session "session-test"\./,
  );
  assert.match(
    blocks[3].content,
    /The current project root is "\/tmp\/downcity-project"\./,
  );
  assert.match(
    blocks[3].content,
    /This session was created at 2026-07-09T08:00:00\.000Z, with Asia\/Shanghai as its reference timezone\./,
  );
  assert.doesNotMatch(blocks[3].content, /[\u3400-\u9fff]/u);
});
