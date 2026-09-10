/** Agent Message 单层展示投影的顺序、过滤与操作规则测试。 */

import assert from "node:assert/strict";
import test from "node:test";
import type { SessionAgentMessagePart } from "@downcity/agent";
import { project_agent_message } from "../src/renderer/features/chat/lib/message/agent_message_projection.ts";

function create_text(type: "text" | "reasoning", sequence: number, text: string): SessionAgentMessagePart {
  return { part_id: `${type}-${sequence}`, sequence, type, text, state: "done" };
}

function create_tool(sequence: number, tool_name = "read"): Extract<SessionAgentMessagePart, { type: "tool" }> {
  return { part_id: `tool-${sequence}`, sequence, type: "tool", tool_call_id: `call-${sequence}`, tool_name, state: "completed", input: {} };
}

test("按 canonical sequence 投影 Text、Activity 与 Text，不依赖数组排列", () => {
  const start = create_text("text", 1, "开始");
  const reasoning = create_text("reasoning", 2, "分析");
  const tool = create_tool(3);
  const end = create_text("text", 4, "结束");
  const parts = [tool, end, start, reasoning];
  const projection = project_agent_message(parts);
  assert.deepEqual(projection.blocks.map((block) => block.type), ["text", "activity", "text"]);
  assert.deepEqual(projection.blocks.flatMap((block) => block.type === "activity" ? block.parts.map((part) => part.type) : [block.type]), ["text", "reasoning", "tool", "text"]);
  assert.equal(projection.text, "开始\n结束");
  assert.equal(projection.show_actions, true);
  assert.deepEqual(parts, [tool, end, start, reasoning]);
});

test("未知 Data 和空 Text 不展示也不切断连续 Activity", () => {
  const first = create_tool(1);
  const last = create_tool(4, "grep");
  const unknown_data: SessionAgentMessagePart = { part_id: "data-2", sequence: 2, type: "data", data_type: "data-unknown", data: {} };
  const blank = create_text("text", 3, "  ");
  const projection = project_agent_message([first, unknown_data, blank, last]);
  assert.equal(projection.blocks.length, 1);
  assert.equal(projection.blocks[0]?.type, "activity");
  assert.deepEqual(projection.blocks[0]?.type === "activity" ? projection.blocks[0].parts : [], [first, last]);
  assert.equal(projection.show_actions, false);
});

test("有效 Turn File Diff Data 投影为独立 Block", () => {
  const projection = project_agent_message([{
    part_id: "data-1",
    sequence: 1,
    type: "data",
    data_type: "data-session-turn-file-diff",
    data: { files: [{ file: "src/a.ts", status: "modified", additions: 1, deletions: 0, patch: "+change" }], additions: 1, deletions: 0 },
  }]);
  assert.equal(projection.blocks[0]?.type, "file-diff");
  assert.equal(projection.blocks[0]?.type === "file-diff" ? projection.blocks[0].data.files[0]?.file : "", "src/a.ts");
});

test("操作栏由最后一个有效操作边界决定，Data 不改变边界", () => {
  const text = create_text("text", 1, "回答");
  const data: SessionAgentMessagePart = { part_id: "data-2", sequence: 2, type: "data", data_type: "data-unknown", data: {} };
  assert.equal(project_agent_message([text, data]).show_actions, true);
  assert.equal(project_agent_message([text, create_tool(2)]).show_actions, false);
  assert.equal(project_agent_message([text, create_text("reasoning", 2, "分析")]).show_actions, false);
  assert.equal(project_agent_message([{ ...text, text: " " }]).show_actions, false);
});

test("投影不修改 canonical Part 与输入数组", () => {
  const parts = [create_tool(1), create_tool(2)];
  const snapshot = [...parts];
  const projection = project_agent_message(parts);
  assert.deepEqual(parts, snapshot);
  assert.strictEqual(parts[0], snapshot[0]);
  assert.strictEqual(projection.blocks[0]?.type === "activity" ? projection.blocks[0].parts[0] : undefined, parts[0]);
});
