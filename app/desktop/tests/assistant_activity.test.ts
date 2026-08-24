/** Assistant 活动分组、操作栏与 Tool 展示语义测试。 */

import assert from "node:assert/strict";
import test from "node:test";
import type { SessionAssistantMessagePart } from "@downcity/agent";
import {
  group_assistant_activities,
  group_assistant_content,
  resolve_tool_presentation,
  should_auto_open_activity_group,
  should_force_open_activity_group,
  should_force_open_tool,
  should_show_assistant_actions,
  type AssistantActivityPart,
} from "../src/renderer/lib/chat/assistant/assistant_activity.ts";

/** 创建测试用 Assistant 文本或 Reasoning part。 */
function create_text_part(type: "text" | "reasoning", sequence: number, text: string): SessionAssistantMessagePart {
  return { part_id: `${type}-${sequence}`, sequence, type, text, state: "done" };
}

/** 创建测试用 Tool part。 */
function create_tool_part(tool_name: string, sequence: number, input: Record<string, string> = {}): Extract<SessionAssistantMessagePart, { type: "tool" }> {
  return { part_id: `tool-${sequence}`, sequence, type: "tool", tool_call_id: `call-${sequence}`, tool_name, state: "completed", input };
}

/** 创建测试用 Interaction part。 */
function create_interaction_part(sequence: number): Extract<SessionAssistantMessagePart, { type: "interaction" }> {
  return {
    part_id: `interaction-${sequence}`,
    sequence,
    type: "interaction",
    interaction_id: `interaction-${sequence}`,
    interaction_type: "question",
    status: "pending",
    request: {
      interaction_id: `interaction-${sequence}`,
      turn_id: "turn-1",
      source: { type: "execution" },
      created_at: 1,
      title: "确认",
      type: "question",
      payload: {
        questions: [{ question_id: "question-1", prompt: "继续吗？", response_type: "text" }],
      },
    },
  };
}

test("按 canonical 顺序保留文本与连续活动块", () => {
  const groups = group_assistant_content([
    create_text_part("text", 1, "开始"),
    create_text_part("reasoning", 2, "分析"),
    create_tool_part("read", 3, { file_path: "README.md" }),
    create_text_part("text", 4, "结束"),
  ]);
  assert.deepEqual(groups.map((group) => group.type), ["part", "activity", "part"]);
  assert.deepEqual(groups.flatMap((group) => group.type === "activity" ? group.parts.map((part) => part.type) : [group.part.type]), ["text", "reasoning", "tool", "text"]);
});

test("step-start 和无展示 data 不切断连续 Tool 折叠组", () => {
  const groups = group_assistant_content([
    create_tool_part("read", 1, { file_path: "a.ts" }),
    { part_id: "step-2", sequence: 2, type: "step-start" },
    { part_id: "data-3", sequence: 3, type: "data", data_type: "data-runtime", data: { phase: "next" } },
    create_tool_part("grep", 4, { pattern: "TODO" }),
    { part_id: "step-5", sequence: 5, type: "step-start" },
    create_text_part("text", 6, "  "),
    create_tool_part("edit", 7, { file_path: "a.ts" }),
  ]);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].type, "activity");
  const activity_parts = groups[0].type === "activity" ? groups[0].parts : [];
  assert.deepEqual(activity_parts.map((part) => part.type), ["tool", "tool", "tool"]);
  const activity_groups = group_assistant_activities(activity_parts, true);
  assert.equal(activity_groups.length, 1);
  assert.equal(activity_groups[0].type === "group" ? activity_groups[0].parts.length : 0, 3);
});

test("连续 Reasoning、Tool 和 Interaction 保持在同一折叠组", () => {
  const parts = [
    create_text_part("reasoning", 1, "分析") as AssistantActivityPart,
    create_tool_part("read", 2) as AssistantActivityPart,
    create_interaction_part(3) as AssistantActivityPart,
    create_tool_part("write", 4) as AssistantActivityPart,
  ];
  const groups = group_assistant_activities(parts, true);
  assert.deepEqual(groups.map((group) => group.type), ["group"]);
  assert.deepEqual(groups[0].type === "group" ? groups[0].parts.map((part) => part.type) : [], ["reasoning", "tool", "interaction", "tool"]);
});

test("关闭 Reasoning 后过滤推理并保留 Tool", () => {
  const groups = group_assistant_activities([
    create_text_part("reasoning", 1, "分析") as AssistantActivityPart,
    create_tool_part("read", 2) as AssistantActivityPart,
  ], false);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].type === "single" ? groups[0].part.type : "", "tool");
});

test("操作栏只在最后一个有效 part 为非空文本时展示", () => {
  const text = create_text_part("text", 1, "回答");
  const ignored_data: SessionAssistantMessagePart = { part_id: "data-2", sequence: 2, type: "data", data_type: "data-test", data: {} };
  const ignored_step: SessionAssistantMessagePart = { part_id: "step-3", sequence: 3, type: "step-start" };
  assert.equal(should_show_assistant_actions([text, ignored_data, ignored_step]), true);
  assert.equal(should_show_assistant_actions([text, create_tool_part("read", 2)]), false);
  assert.equal(should_show_assistant_actions([text, create_text_part("reasoning", 2, "分析")]), false);
  assert.equal(should_show_assistant_actions([{ ...text, text: "  " }]), false);
});

test("Tool 名称映射为稳定视觉语义与详情", () => {
  const cases: Array<[string, Record<string, string>, string, string]> = [
    ["read", { file_path: "src/a.ts" }, "read", "src/a.ts"],
    ["write", { path: "src/b.ts" }, "write", "src/b.ts"],
    ["edit", { filename: "src/c.ts" }, "edit", "src/c.ts"],
    ["grep", { pattern: "TODO" }, "grep", "TODO"],
    ["find", { glob: "**/*.ts" }, "find", "**/*.ts"],
    ["shell_exec", { command: "pnpm test" }, "shell", "pnpm test"],
    ["shell_session", { action: "poll" }, "shell", "poll"],
    ["ask_question", {}, "ask", "ask_question"],
    ["plugin_call", { plugin: "github", action: "search" }, "plugin", "github · search"],
    ["custom_tool", {}, "generic", "custom_tool"],
  ];
  for (const [tool_name, input, visual_kind, detail] of cases) {
    const presentation = resolve_tool_presentation(create_tool_part(tool_name, 1, input));
    assert.equal(presentation.visual_kind, visual_kind);
    assert.equal(presentation.detail, detail);
  }
});

test("Tool 生命周期映射为运行、完成、等待与失败文案", () => {
  const tool = create_tool_part("read", 1);
  assert.equal(resolve_tool_presentation({ ...tool, state: "running" }).state_label, "正在读取");
  assert.equal(resolve_tool_presentation({ ...tool, state: "completed" }).state_label, "已读取");
  assert.equal(resolve_tool_presentation({ ...tool, state: "waiting-user" }).state_label, "等待确认");
  assert.equal(resolve_tool_presentation({ ...tool, state: "failed" }).state_label, "读取失败");
});

test("只有流式写入和编辑工具强制展开详情", () => {
  const write = create_tool_part("write", 1, { path: "a.ts" });
  const edit = create_tool_part("edit", 2, { path: "b.ts" });
  const read = create_tool_part("read", 3, { path: "c.ts" });
  assert.equal(should_force_open_tool({ ...write, state: "input-streaming" }), true);
  assert.equal(should_force_open_tool({ ...edit, state: "input-streaming" }), true);
  assert.equal(should_force_open_tool({ ...read, state: "input-streaming" }), false);
  assert.equal(should_force_open_tool({ ...write, state: "running" }), false);
  assert.equal(should_force_open_tool({ ...write, state: "completed" }), false);
});

test("待响应 Interaction 自动展开但不锁定活动组", () => {
  const tool = create_tool_part("shell_exec", 1, { command: "pnpm test" });
  const interaction = create_interaction_part(2);
  const pending_parts = [tool as AssistantActivityPart, interaction as AssistantActivityPart];
  const resolved_parts = [tool as AssistantActivityPart, { ...interaction, status: "resolved" } as AssistantActivityPart];
  assert.equal(should_auto_open_activity_group(pending_parts), true);
  assert.equal(should_force_open_activity_group(pending_parts), false);
  assert.equal(should_auto_open_activity_group(resolved_parts), false);
});
