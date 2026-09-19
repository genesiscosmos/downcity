/**
 * @file 验证 SDK session system blocks 的稳定分层顺序。
 *
 * 关键点（中文）
 * - 测试编译后的 bin 输出，避免测试文件依赖 TS 源码加载器。
 * - Agent 身份与 Downcity core 由 SDK 注入，不能被调用方 instruction 替代。
 * - 身份块必须同时给出 agent name 与 id，且不携带项目路径。
 */

import test from "node:test";
import assert from "node:assert/strict";

import { create_instruction_system_blocks } from "../bin/agent/AgentInstructions.js";
import { build_session_system_blocks } from "../bin/session/input/SessionSystem.js";

test("instruction blocks keep identity, custom instruction, and Downcity core in order", () => {
  const blocks = create_instruction_system_blocks({
    agent_id: "reviewer",
    agent_name: "Code Reviewer",
    instruction: ["你是这个项目的工程 agent。"],
  });

  assert.deepEqual(
    blocks.map((block) => `${block.source}:${block.name}`),
    ["instruction:identity", "instruction:agent", "core:default"],
  );
  assert.match(blocks[0].content, /^# Agent Identity/);
  assert.match(blocks[0].content, /You are "Code Reviewer" \(agent id: reviewer\)\./);
  assert.equal(blocks[1].content, "你是这个项目的工程 agent。");
  assert.match(blocks[2].content, /# Harness Design/);
  assert.match(blocks[2].content, /human-owned workspace/);
  assert.match(blocks[2].content, /project structure is the control surface/);
  assert.match(blocks[2].content, /# Shell Commands/);
  assert.match(blocks[2].content, /# Power System/);
  assert.doesNotMatch(blocks[2].content, /\/tmp\/downcity-project/);
  assert.doesNotMatch(blocks[2].content, /current year/i);
  assert.doesNotMatch(blocks[2].content, /# Project Runtime/);
  assert.doesNotMatch(blocks[2].content, /\.downcity\/agents/);
  assert.doesNotMatch(blocks[2].content, /\.downcity\/memory/);
  assert.doesNotMatch(blocks[2].content, /\.downcity\/public/);
});

test("identity block falls back to agent id when name is empty", () => {
  const blocks = create_instruction_system_blocks({
    agent_id: "reviewer",
    agent_name: "  ",
    instruction: [],
  });

  assert.deepEqual(
    blocks.map((block) => `${block.source}:${block.name}`),
    ["instruction:identity", "core:default"],
  );
  assert.match(blocks[0].content, /You are "reviewer" \(agent id: reviewer\)\./);
});

test("session system blocks are ordered as identity, instruction, core, power, session", async () => {
  const blocks = await build_session_system_blocks({
    agent_id: "agent-test",
    project_root: "/tmp/downcity-project",
    session_id: "session-test",
    created_at: Date.UTC(2026, 6, 9, 8, 0, 0),
    timezone: "Asia/Shanghai",
    get_instruction_system_blocks: () =>
      create_instruction_system_blocks({
        agent_id: "agent-test",
        agent_name: "Agent Test",
        instruction: ["使用中文回复。"],
      }),
    get_managed_power_system_blocks: async () => [],
    get_power_system_blocks: async () => [
      {
        source: "power",
        name: "task",
        content: "# Task Power\n\n任务插件说明。",
      },
    ],
  });

  assert.deepEqual(
    blocks.map((block) => `${block.source}:${block.name}`),
    [
      "instruction:identity",
      "instruction:agent",
      "core:default",
      "power:task",
      "session:context",
    ],
  );
  assert.match(blocks[0].content, /You are "Agent Test" \(agent id: agent-test\)\./);
  assert.equal(blocks[1].content, "使用中文回复。");
  assert.match(blocks[2].content, /# Power System/);
  assert.equal(blocks[3].content, "# Task Power\n\n任务插件说明。");
  assert.match(blocks[4].content, /^Current session context:/);
  assert.match(blocks[4].content, /This session is "session-test"\./);
  assert.match(
    blocks[4].content,
    /The current project root is "\/tmp\/downcity-project"\./,
  );
  assert.match(
    blocks[4].content,
    /This session was created at 2026-07-09T08:00:00\.000Z, with Asia\/Shanghai as its reference timezone\./,
  );
  // session block 只描述 session 自身，不得重复 agent 身份。
  assert.doesNotMatch(blocks[4].content, /agent-test/);
  assert.doesNotMatch(blocks[4].content, /Agent Test/);
  assert.doesNotMatch(blocks[4].content, /[\u3400-\u9fff]/u);
});
