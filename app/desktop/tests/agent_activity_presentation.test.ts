/** Agent 活动（Reasoning / Tool / Action）展示语义、流式输入读取与 Activity 展开策略测试。 */

import assert from "node:assert/strict";
import test from "node:test";
import type { SessionAgentActionPart, SessionAgentInteraction, SessionAgentMessagePart, SessionAgentToolPart } from "@downcity/agent";
import { read_streaming_input_values, resolve_agent_action_presentation, resolve_agent_tool_presentation, select_activity_summary_part, should_auto_open_agent_activity, should_auto_open_agent_tool } from "../src/renderer/features/chat/lib/message/agent_activity_presentation.ts";
import type { AgentActivityPart, AgentActivityTone } from "../src/renderer/features/chat/types/AgentMessage.ts";

function create_tool(tool_name: string, sequence: number, input: Record<string, string> = {}): SessionAgentToolPart {
  return { part_id: `tool-${sequence}`, sequence, type: "tool", tool_call_id: `call-${sequence}`, tool_name, state: "completed", input };
}

function create_action(action_type: string, sequence: number, state: SessionAgentActionPart["state"] = "completed"): SessionAgentActionPart {
  return { part_id: `action-${sequence}`, sequence, type: "action", action_id: `action-${sequence}`, action_type, state, title: "Forking session messages" };
}

function create_interaction(sequence: number, status: SessionAgentInteraction["status"] = "pending"): SessionAgentInteraction {
  return { interaction_id: `interaction-${sequence}`, interaction_type: "question", status, request: { interaction_id: `interaction-${sequence}`, turn_id: "turn-1", source: { type: "execution" }, created_at: 1, title: "确认", type: "question", payload: { questions: [] } } };
}

test("Tool 名称映射为稳定视觉语义与摘要", () => {
  const cases: Array<[string, Record<string, string>, string, string]> = [
    ["read", { file_path: "src/a.ts" }, "read", "src/a.ts"], ["write", { path: "src/b.ts" }, "write", "src/b.ts"], ["edit", { filename: "src/c.ts" }, "edit", "src/c.ts"], ["grep", { pattern: "TODO" }, "grep", "TODO"], ["find", { glob: "**/*.ts" }, "find", "**/*.ts"], ["shell_exec", { command: "pnpm test" }, "shell", "pnpm test"], ["shell_session", { action: "poll" }, "shell", "poll"], ["ask_question", {}, "ask", "ask_question"], ["plugin_call", { plugin: "github", action: "search" }, "plugin", "github · search"], ["custom_tool", {}, "generic", "custom_tool"],
  ];
  for (const [tool_name, input, visual_kind, summary] of cases) {
    const presentation = resolve_agent_tool_presentation(create_tool(tool_name, 1, input));
    assert.equal(presentation.visual_kind, visual_kind);
    assert.equal(presentation.summary, summary);
  }
});

test("Tool 生命周期映射为状态文案与行语气", () => {
  const tool = create_tool("read", 1);
  const cases: Array<[SessionAgentToolPart["state"], string, AgentActivityTone]> = [
    ["input-streaming", "activity.read.running", "running"],
    ["ready", "activity.read.running", "running"],
    ["running", "activity.read.running", "running"],
    ["waiting-user", "activity.waiting_confirmation", "complete"],
    ["completed", "activity.read.completed", "complete"],
    ["failed", "activity.read.failed", "failed"],
  ];
  for (const [state, state_key, tone] of cases) {
    const presentation = resolve_agent_tool_presentation({ ...tool, state });
    assert.equal(presentation.state_key, state_key);
    assert.equal(presentation.tone, tone);
  }
});

test("展开详情按 Tool 种类给出代码、控制台与编辑对照", () => {
  const write = resolve_agent_tool_presentation(create_tool("write", 1, { file_path: "a.ts", content: "const a = 1;" }));
  assert.deepEqual(write.detail, { type: "code", text: "const a = 1;" });

  const shell = resolve_agent_tool_presentation({ ...create_tool("shell_exec", 2, { cmd: "pnpm test" }), output: "ok" });
  assert.deepEqual(shell.detail, { type: "console", text: "$ pnpm test\nok" });

  const edit = resolve_agent_tool_presentation({ ...create_tool("edit", 3), input: { file_path: "a.ts", edits: [{ old_text: "a", new_text: "b" }, { old_text: "c", new_text: "d" }] } });
  assert.deepEqual(edit.detail, { type: "edit", pairs: [{ old_text: "a", new_text: "b" }, { old_text: "c", new_text: "d" }] });
});

test("失败原因与展开详情相互独立", () => {
  const failed = resolve_agent_tool_presentation({ ...create_tool("read", 1), state: "failed", error: "ENOENT" });
  assert.equal(failed.error, "ENOENT");
  assert.equal(failed.detail, null);
  assert.equal(resolve_agent_tool_presentation(create_tool("read", 1)).error, "");
});

test("流式输入按字段名读取，字段名出现在内容里不误配", () => {
  const input_text = "{\"file_path\":\"src/a.ts\",\"content\":\"const key = \\\"content\\\";\\nline2";
  assert.deepEqual(read_streaming_input_values(input_text, "file_path"), ["src/a.ts"]);
  assert.deepEqual(read_streaming_input_values(input_text, "content"), ["const key = \"content\";\nline2"]);
  assert.deepEqual(read_streaming_input_values(input_text, "edits"), []);

  const write = resolve_agent_tool_presentation({ ...create_tool("write", 1), state: "input-streaming", input: undefined, input_text });
  assert.equal(write.input_streaming, true);
  assert.equal(write.summary, "src/a.ts");
  assert.deepEqual(write.detail, { type: "code", text: "const key = \"content\";\nline2" });
});

test("流式 Edit 按出现顺序配对旧文与新文", () => {
  const input_text = "{\"file_path\":\"a.ts\",\"edits\":[{\"old_text\":\"a\",\"new_text\":\"b\"},{\"old_text\":\"c\",\"new_text\":\"d";
  const edit = resolve_agent_tool_presentation({ ...create_tool("edit", 1), state: "input-streaming", input: undefined, input_text });
  assert.equal(edit.summary, "a.ts");
  assert.deepEqual(edit.detail, { type: "edit", pairs: [{ old_text: "a", new_text: "b" }, { old_text: "c", new_text: "d" }] });
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
  // Interaction 不是独立 Part，而是所属 Tool 的一部分；Activity 由 Tool、Reasoning 与 Action 组成。
  const pending: AgentActivityPart[] = [{ ...tool, interactions: [create_interaction(1, "pending")] }];
  const resolved: AgentActivityPart[] = [{ ...tool, interactions: [create_interaction(1, "resolved")] }];
  assert.equal(should_auto_open_agent_activity(pending), true);
  assert.equal(should_auto_open_agent_activity(resolved), false);
});

test("未知 Tool 输出仍给出可展开正文", () => {
  const tool: SessionAgentMessagePart = { ...create_tool("custom_tool", 1), output: { nested: { value: "x" }, count: 2 } };
  const presentation = resolve_agent_tool_presentation(tool as SessionAgentToolPart);
  assert.deepEqual(presentation.detail, { type: "code", text: "nested: value: x\ncount: 2" });
});

test("Action 类别映射为稳定视觉语义", () => {
  const cases: Array<[string, string]> = [
    ["history-fork", "fork"],
    ["context-compaction", "compaction"],
    ["command", "command"],
    ["deploy", "generic"],
  ];
  for (const [action_type, visual_kind] of cases) {
    assert.equal(resolve_agent_action_presentation(create_action(action_type, 1)).visual_kind, visual_kind);
  }
});

test("Action 生命周期映射为状态文案与行语气", () => {
  const cases: Array<[SessionAgentActionPart["state"], string, AgentActivityTone]> = [
    ["running", "activity.action.running", "running"],
    ["completed", "activity.action.completed", "complete"],
    ["failed", "activity.action.failed", "failed"],
  ];
  for (const [state, state_key, tone] of cases) {
    const presentation = resolve_agent_action_presentation(create_action("command", 1, state));
    assert.equal(presentation.state_key, state_key);
    assert.equal(presentation.tone, tone);
  }
});

test("Action 摘要取标题，描述与结构化信息进入展开详情", () => {
  const presentation = resolve_agent_action_presentation({ ...create_action("context-compaction", 1), title: "Context compacted", description: "Removed 12 messages.", data: { removed: 12 } });
  assert.equal(presentation.summary, "Context compacted");
  assert.deepEqual(presentation.detail, { type: "code", text: "Removed 12 messages.\nremoved: 12" });
  assert.equal(presentation.error, "");
  assert.equal(presentation.input_streaming, false);
});

test("Action 没有描述与结构化信息时不可展开", () => {
  assert.equal(resolve_agent_action_presentation(create_action("command", 1)).detail, null);
});

test("失败的 Action 把描述当作错误原因，不重复进入详情", () => {
  const presentation = resolve_agent_action_presentation({ ...create_action("history-fork", 1, "failed"), description: "disk full", data: { target: "fork-1" } });
  assert.equal(presentation.error, "disk full");
  assert.deepEqual(presentation.detail, { type: "code", text: "target: fork-1" });
});

test("标题为空时 Action 回退为 action_type", () => {
  assert.equal(resolve_agent_action_presentation({ ...create_action("deploy", 1), title: "  " }).summary, "deploy");
});

test("Action 不触发活动组自动展开", () => {
  assert.equal(should_auto_open_agent_activity([create_action("command", 1, "running")]), false);
});

test("组摘要取最后一个非 Reasoning 项，Tool 与 Action 一视同仁", () => {
  const read = create_tool("read", 1);
  const grep = create_tool("grep", 2);
  const action = create_action("history-fork", 3);
  const reasoning = { part_id: "reasoning-4", sequence: 4, type: "reasoning" as const, text: "想一下", state: "done" as const };

  assert.equal(select_activity_summary_part([read, grep]), grep);
  // Action 与 Tool 同级：它发生在后，摘要就该是它，而不是更早的 Tool。
  assert.equal(select_activity_summary_part([read, action]), action);
  assert.equal(select_activity_summary_part([action, read]), read);
  assert.equal(select_activity_summary_part([read, reasoning]), read);
});

test("组内全部为 Reasoning 或为空时，组摘要选择不抛错", () => {
  const first = { part_id: "reasoning-1", sequence: 1, type: "reasoning" as const, text: "第一步", state: "done" as const };
  const last = { part_id: "reasoning-2", sequence: 2, type: "reasoning" as const, text: "第二步", state: "done" as const };

  assert.equal(select_activity_summary_part([first, last]), last);
  assert.equal(select_activity_summary_part([]), undefined);
});

test("Action 展示信息可直接驱动活动行，不需要组件按 action_type 分支", () => {
  const presentation = resolve_agent_action_presentation(create_action("context-compaction", 1, "running"));
  assert.equal(presentation.visual_kind, "compaction");
  assert.equal(presentation.tone, "running");
  assert.equal(presentation.state_key, "activity.action.running");
});
