/** Session mutation Renderer 投影测试。 */

import assert from "node:assert/strict";
import test from "node:test";
import type { SessionAssistantMessage, SessionMutation, SessionUserMessage } from "@downcity/agent";
import { apply_session_mutation, merge_session_snapshot } from "../src/renderer/lib/chat/session_mutation.ts";

const assistant_message: SessionAssistantMessage = {
  message_id: "assistant-1",
  session_id: "session-1",
  turn_id: "turn-1",
  sequence: 2,
  revision: 1,
  visibility: "visible",
  created_at: 1,
  updated_at: 1,
  type: "assistant",
  kind: "normal",
  status: "streaming",
  parts: [{ part_id: "text-1", sequence: 1, type: "text", text: "你", state: "streaming" }],
};

test("按 delta 更新 assistant part 并拒绝旧 revision", () => {
  const delta: SessionMutation = {
    mutation_id: "mutation-1",
    session_id: "session-1",
    created_at: 2,
    variant: "delta",
    type: "text",
    message_id: "assistant-1",
    turn_id: "turn-1",
    revision: 2,
    part_id: "text-1",
    delta: "好",
  };
  const updated = apply_session_mutation([assistant_message], delta);
  assert.equal(updated[0].revision, 2);
  assert.equal(updated[0].type === "assistant" && updated[0].parts[0].type === "text" ? updated[0].parts[0].text : "", "你好");
  assert.equal(apply_session_mutation(updated, { ...delta, mutation_id: "mutation-old", revision: 1, delta: "旧" }), updated);
});

test("较旧 snapshot 不覆盖已经收到的实时消息", () => {
  const user_message: SessionUserMessage = {
    message_id: "user-1",
    session_id: "session-1",
    turn_id: "turn-1",
    sequence: 1,
    revision: 1,
    visibility: "visible",
    created_at: 1,
    updated_at: 1,
    type: "user",
    input_type: "prompt",
    parts: [{ part_id: "user-text-1", type: "text", text: "问题", state: "done" }],
  };
  const live_message = { ...assistant_message, revision: 3 };
  const merged = merge_session_snapshot([live_message], [user_message, assistant_message]);
  assert.deepEqual(merged.map((message) => message.message_id), ["user-1", "assistant-1"]);
  assert.equal(merged[1].revision, 3);
});
