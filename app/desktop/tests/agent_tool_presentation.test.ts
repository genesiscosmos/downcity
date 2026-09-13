/** Agent Tool 展示语义与 Activity 展开策略测试。 */

import assert from "node:assert/strict";
import test from "node:test";
import type { SessionAgentInteraction, SessionAgentMessagePart } from "@downcity/agent";
import { resolve_agent_tool_presentation, should_auto_open_agent_activity, should_auto_open_agent_tool } from "../src/renderer/features/chat/lib/message/agent_tool_presentation.ts";
import type { AgentActivityPart } from "../src/renderer/features/chat/types/AgentMessage.ts";

function create_tool(tool_name: string, sequence: number, input: Record<string, string> = {}): Extract<SessionAgentMessagePart, { type: "tool" }> {
  return { part_id: `tool-${sequence}`, sequence, type: "tool", tool_call_id: `call-${sequence}`, tool_name, state: "completed", input };
}

function create_interaction(sequence: number, status: SessionAgentInteraction["status"] = "pending"): SessionAgentInteraction {
  return { interaction_id: `interaction-${sequence}`, interaction_type: "question", status, request: { interaction_id: `interaction-${sequence}`, turn_id: "turn-1", source: { type: "execution" }, created_at: 1, title: "确认", type: "question", payload: { questions: [] } } };
}

test("Tool 名称映射为稳定视觉语义与详情", () => {
  const cases: Array<[string, Record<string, string>, string, string]> = [
    ["read", { file_path: "src/a.ts" }, "read", "src/a.ts"], ["write", { path: "src/b.ts" }, "write", "src/b.ts"], ["edit", { filename: "src/c.ts" }, "edit", "src/c.ts"], ["grep", { pattern: "TODO" }, "grep", "TODO"], ["find", { glob: "**/*.ts" }, "find", "**/*.ts"], ["shell_exec", { command: "pnpm test" }, "shell", "pnpm test"], ["shell_session", { action: "poll" }, "shell", "poll"], ["ask_question", {}, "ask", "ask_question"], ["plugin_call", { plugin: "github", action: "search" }, "plugin", "github · search"], ["custom_tool", {}, "generic", "custom_tool"],
  ];
  for (const [tool_name, input, visual_kind, detail] of cases) {
    const presentation = resolve_agent_tool_presentation(create_tool(tool_name, 1, input));
    assert.equal(presentation.visual_kind, visual_kind);
    assert.equal(presentation.detail, detail);
  }
});

test("Tool 生命周期映射为运行、完成、等待与失败文案", () => {
  const tool = create_tool("read", 1);
  assert.equal(resolve_agent_tool_presentation({ ...tool, state: "running" }).state_key, "activity.read.running");
  assert.equal(resolve_agent_tool_presentation({ ...tool, state: "completed" }).state_key, "activity.read.completed");
  assert.equal(resolve_agent_tool_presentation({ ...tool, state: "waiting-user" }).state_key, "activity.waiting_confirmation");
  assert.equal(resolve_agent_tool_presentation({ ...tool, state: "failed" }).state_key, "activity.read.failed");
});

test("只有流式 Write 与 Edit Tool 初始自动展开", () => {
  const write = create_tool("write", 1);
  const edit = create_tool("edit", 2);
  const read = create_tool("read", 3);
  assert.equal(should_auto_open_agent_tool({ ...write, state: "input-streaming" }), true);
  assert.equal(should_auto_open_agent_tool({ ...edit, state: "input-streaming" }), true);
  assert.equal(should_auto_open_agent_tool({ ...read, state: "input-streaming" }), false);
  assert.equal(should_auto_open_agent_tool({ ...write, state: "running" }), false);
  assert.equal(should_auto_open_agent_activity([{ ...edit, state: "input-streaming" }]), true);
});

test("待响应 Interaction 自动展开但不锁定 Activity", () => {
  const tool = create_tool("shell_exec", 1);
  // Interaction 不是独立 Part，而是所属 Tool 的一部分；Activity 只由 Tool 与 Reasoning 组成。
  const pending: AgentActivityPart[] = [{ ...tool, interactions: [create_interaction(1, "pending")] }];
  const resolved: AgentActivityPart[] = [{ ...tool, interactions: [create_interaction(1, "resolved")] }];
  assert.equal(should_auto_open_agent_activity(pending), true);
  assert.equal(should_auto_open_agent_activity(resolved), false);
});
