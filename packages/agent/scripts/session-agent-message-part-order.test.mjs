/**
 * @file 验证 Agent Message 的终态 Error 与 Turn 结果 Part 使用同一 canonical sequence。
 */

import assert from "node:assert/strict";
import test from "node:test";
import { SessionAgentMessageWriter } from "../bin/session/SessionMessages.js";

/** 使用最小内存 Recorder 验证 Writer 的 Part 顺序能力。 */
test("Error Part 在后续 Turn 结果 Data Part 之前写入", async () => {
  let message = {
    message_id: "agent:session-1:message-1",
    session_id: "session-1",
    turn_id: "turn-1",
    sequence: 2,
    revision: 1,
    visibility: "visible",
    created_at: 1,
    updated_at: 1,
    role: "agent",
    state: "streaming",
    parts: [],
  };
  const cache = {
    get: () => message,
  };
  const state = {
    project_part: (_message_id, part) => {
      const index = message.parts.findIndex((candidate) => candidate.part_id === part.part_id);
      const parts = [...message.parts];
      if (index < 0) parts.push(part);
      else parts[index] = part;
      message = { ...message, parts };
    },
    commit_parts: async (_message_id, new_parts) => {
      message = {
        ...message,
        revision: message.revision + 1,
        parts: [...message.parts, ...new_parts],
      };
    },
    complete: async (_message_id, status) => {
      message = { ...message, state: "done", revision: message.revision + 1 };
    },
  };
  const writer = new SessionAgentMessageWriter({
    message_id: message.message_id,
    state,
    cache,
  });

  await writer.append_result_parts([{ type: "text", text: "处理中" }]);
  await writer.append_error({
    scope: "turn",
    code: "turn_execution_failed",
    message: "执行失败",
    recoverable: true,
  });
  await writer.append_result_parts([{
    type: "data",
    data_type: "data-session-turn-file-diff",
    data: { files: [], additions: 0, deletions: 0 },
  }]);
  await writer.fail("执行失败");

  assert.deepEqual(message.parts.map((part) => part.type), ["text", "error", "data"]);
  assert.deepEqual(message.parts.map((part) => part.sequence), [1, 2, 3]);
  assert.equal(message.state, "done");
});
