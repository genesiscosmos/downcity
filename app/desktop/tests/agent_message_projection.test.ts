/** Agent Message 单层展示投影的顺序、过滤与操作规则测试。 */

import assert from "node:assert/strict";
import test from "node:test";
import type { SessionAgentMessagePart } from "@downcity/agent";
import { project_agent_message } from "../src/renderer/features/chat/lib/message/agent_message_projection.ts";

function create_text(type: "text" | "reasoning", sequence: number, text: string, state: "streaming" | "done" = "done"): SessionAgentMessagePart {
  return { part_id: `${type}-${sequence}`, sequence, type, text, state };
}

function create_tool(sequence: number, tool_name = "read"): Extract<SessionAgentMessagePart, { type: "tool" }> {
  return { part_id: `tool-${sequence}`, sequence, type: "tool", tool_call_id: `call-${sequence}`, tool_name, state: "completed", input: {} };
}

function create_action(sequence: number, action_type = "context-compaction"): Extract<SessionAgentMessagePart, { type: "action" }> {
  return { part_id: `action-${sequence}`, sequence, type: "action", action_id: `action-${sequence}`, action_type, state: "completed", title: "Action" };
}

test("按 canonical sequence 投影，并把过程与内容切在最后一个活动之后", () => {
  const start = create_text("text", 1, "开始");
  const tool = create_tool(3);
  const end = create_text("text", 4, "结束");
  const parts = [tool, end, start];
  const projection = project_agent_message(parts);
  // 过程 = 最后一个活动及其之前（正文 + 活动），内容 = 其后的正文。
  assert.deepEqual(projection.process_blocks.map((block) => block.type), ["text", "activity"]);
  assert.deepEqual(projection.content_blocks.map((block) => block.type), ["text"]);
  assert.equal(projection.process_blocks[0]?.type === "text" ? projection.process_blocks[0].part.text : "", "开始");
  assert.equal(projection.content_blocks[0]?.type === "text" ? projection.content_blocks[0].part.text : "", "结束");
  assert.equal(projection.text, "开始\n结束");
  assert.deepEqual(parts, [tool, end, start]);
});

test("没有活动时过程为空，全部块都是内容", () => {
  const projection = project_agent_message([create_text("text", 1, "只有正文")]);
  assert.deepEqual(projection.process_blocks, []);
  assert.deepEqual(projection.content_blocks.map((block) => block.type), ["text"]);
});

test("正在输出的推理按顺序并入连续活动，正文不包含推理", () => {
  const tool = create_tool(1);
  const running = create_text("reasoning", 2, "正在想", "streaming");
  const end = create_text("text", 3, "结论");
  const projection = project_agent_message([tool, running, end]);

  // 思考和工具共享活动块与过程折叠，保持原始 Part 顺序。
  assert.deepEqual(projection.process_blocks.map((block) => block.type), ["activity"]);
  assert.deepEqual(projection.content_blocks.map((block) => block.type), ["text"]);
  assert.deepEqual(projection.process_blocks[0]?.type === "activity" ? projection.process_blocks[0].parts : [], [tool, running]);
  // 推理不是正文，不进入 Copy / Quote 文本。
  assert.equal(projection.text, "结论");
});

test("推理开始时即显示活动，尚无正文也能表达运行状态", () => {
  const part = create_text("reasoning", 1, "", "streaming");
  const projection = project_agent_message([part]);
  assert.deepEqual(projection.process_blocks, [{ type: "activity", parts: [part] }]);
  assert.deepEqual(projection.content_blocks, []);
});

test("已完成推理保留活动记录，与工具共同决定过程切分", () => {
  const done = create_text("reasoning", 2, "已经想完", "done");
  assert.deepEqual(project_agent_message([done]).process_blocks, [{ type: "activity", parts: [done] }]);
  const tool = create_tool(1);
  const end = create_text("text", 3, "结论");
  const projection = project_agent_message([tool, done, end]);
  assert.deepEqual(projection.process_blocks.map((block) => block.type), ["activity"]);
  assert.deepEqual(projection.content_blocks.map((block) => block.type), ["text"]);
});

test("多段推理保留原始顺序，关闭推理展示时不影响正文", () => {
  const parts = [create_text("reasoning", 1, "第一段", "done"), create_text("reasoning", 2, "第二段", "streaming")];
  assert.deepEqual(project_agent_message(parts).process_blocks, [{ type: "activity", parts }]);
  const hidden = project_agent_message([...parts, create_text("text", 3, "回答")], false);
  assert.deepEqual(hidden.process_blocks, []);
  assert.deepEqual(hidden.content_blocks.map((block) => block.type), ["text"]);
  assert.equal(hidden.text, "回答");
});

test("未知 Data 和空 Text 不展示也不切断连续 Activity", () => {
  const first = create_tool(1);
  const last = create_tool(4, "grep");
  const unknown_data: SessionAgentMessagePart = { part_id: "data-2", sequence: 2, type: "data", data_type: "data-unknown", data: {} };
  const blank = create_text("text", 3, "  ");
  const projection = project_agent_message([first, unknown_data, blank, last]);
  assert.equal(projection.process_blocks.length, 1);
  assert.equal(projection.process_blocks[0]?.type, "activity");
  assert.deepEqual(projection.process_blocks[0]?.type === "activity" ? projection.process_blocks[0].parts : [], [first, last]);
  assert.deepEqual(projection.content_blocks, []);
});

test("有效 Turn File Diff Data 投影为独立 Block", () => {
  const projection = project_agent_message([{
    part_id: "data-1",
    sequence: 1,
    type: "data",
    data_type: "data-session-turn-file-diff",
    data: { files: [{ file: "src/a.ts", status: "modified", additions: 1, deletions: 0, patch: "+change" }], additions: 1, deletions: 0 },
  }]);
  // Data 不是活动，因此它落在内容段里。
  assert.equal(projection.content_blocks[0]?.type, "file-diff");
  assert.equal(projection.content_blocks[0]?.type === "file-diff" ? projection.content_blocks[0].data.files[0]?.file : "", "src/a.ts");
});

test("Action 并入相邻活动，不切断活动组也不产生独立 Block", () => {
  const tool = create_tool(1);
  const action = create_action(2);
  const reasoning = create_text("reasoning", 3, "继续");
  const projection = project_agent_message([tool, action, reasoning]);

  assert.equal(projection.process_blocks.length, 1);
  assert.equal(projection.process_blocks[0]?.type, "activity");
  assert.deepEqual(projection.process_blocks[0]?.type === "activity" ? projection.process_blocks[0].parts.map((part) => part.type) : [], ["tool", "action", "reasoning"]);
});

test("Action 不产生独立 Block，也不改变内容切分", () => {
  const text = create_text("text", 1, "回答");
  const tool = create_tool(2);
  const action = create_action(3);
  const projection = project_agent_message([text, tool, action]);
  assert.equal(projection.process_blocks.length, 2);
  assert.equal(projection.process_blocks[1]?.type, "activity");
  assert.deepEqual(projection.process_blocks[1]?.type === "activity" ? projection.process_blocks[1].parts.map((part) => part.type) : [], ["tool", "action"]);
  assert.deepEqual(projection.content_blocks, []);
});

test("Data 不改变内容切分点", () => {
  const text = create_text("text", 1, "回答");
  const data: SessionAgentMessagePart = { part_id: "data-2", sequence: 2, type: "data", data_type: "data-unknown", data: {} };
  const projection = project_agent_message([text, data]);
  assert.deepEqual(projection.process_blocks, []);
  assert.deepEqual(projection.content_blocks.map((block) => block.type), ["text"]);
});

test("投影不修改 canonical Part 与输入数组", () => {
  const parts = [create_tool(1), create_tool(2)];
  const snapshot = [...parts];
  const projection = project_agent_message(parts);
  assert.deepEqual(parts, snapshot);
  assert.strictEqual(parts[0], snapshot[0]);
  assert.strictEqual(projection.process_blocks[0]?.type === "activity" ? projection.process_blocks[0].parts[0] : undefined, parts[0]);
});
