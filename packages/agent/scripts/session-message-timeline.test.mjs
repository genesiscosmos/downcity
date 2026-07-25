/**
 * @file 验证 canonical Session Message 到宿主时间线的稳定投影。
 */

import assert from "node:assert/strict";
import test from "node:test";
import { to_session_message_timeline_events } from "../bin/index.js";

test("Session timeline preserves assistant text and tool order", () => {
  const message = {
    message_id: "assistant-1",
    session_id: "session-1",
    turn_id: "turn-1",
    sequence: 1,
    revision: 1,
    visibility: "visible",
    created_at: 10,
    updated_at: 20,
    type: "assistant",
    kind: "normal",
    segment_index: 1,
    status: "completed",
    parts: [
      {
        part_id: "text-1",
        sequence: 1,
        type: "text",
        text: "checking",
        state: "done",
      },
      {
        part_id: "tool-1",
        sequence: 2,
        type: "tool",
        tool_call_id: "call-1",
        tool_name: "read",
        state: "completed",
        input: { path: "README.md" },
        output: { text: "ok" },
      },
      {
        part_id: "text-2",
        sequence: 3,
        type: "text",
        text: "done",
        state: "done",
      },
    ],
  };

  const events = to_session_message_timeline_events(message);
  assert.deepEqual(events.map((event) => event.role), [
    "assistant",
    "tool-call",
    "tool-result",
    "assistant",
  ]);
  assert.deepEqual(events.map((event) => event.id), [
    "assistant-1:0",
    "assistant-1:1",
    "assistant-1:2",
    "assistant-1:3",
  ]);
  assert.equal(events[1].toolName, "read");
  assert.match(events[2].text, /"ok"/);
});
