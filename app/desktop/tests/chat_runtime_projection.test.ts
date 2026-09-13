/** Desktop Chat 跨 Session 运行态聚合测试。 */

import assert from "node:assert/strict";
import test from "node:test";
import type { DesktopChatRuntime } from "../src/common/types/DesktopApi.ts";
import { collect_agent_chat_status, project_active_turn_file_diff, project_agent_chat_status, resolve_chat_session_live_status } from "../src/renderer/features/chat/lib/chat_runtime_projection.ts";

function create_runtime(session_id: string, status: DesktopChatRuntime["status"], agent_id = "builder"): DesktopChatRuntime {
  return { agent_id, workspace_id: "workspace", session_id, status, updated_at: 1 };
}

test("实时文件改动只归属于当前 Turn", () => {
  const previous_diff = { turn_id: "turn-1", files_count: 2, additions: 8, deletions: 3 };
  assert.equal(project_active_turn_file_diff({ ...create_runtime("session", "streaming"), turn_id: "turn-1" }, previous_diff), previous_diff);
  assert.equal(project_active_turn_file_diff({ ...create_runtime("session", "streaming"), turn_id: "turn-2" }, previous_diff), undefined);
  assert.equal(project_active_turn_file_diff(create_runtime("session", "submitted"), previous_diff), undefined);
});

test("一个 Session 结束时保留同 Agent 的其它运行中 Session", () => {
  const runtimes = {
    first: create_runtime("first", "streaming"),
    second: create_runtime("second", "streaming"),
  };
  const current = { builder: "working" as const };
  assert.equal(project_agent_chat_status(current, runtimes, "first", create_runtime("first", "completed")), current);
  assert.equal(project_agent_chat_status(current, runtimes, "first"), current);
});

test("最后一个运行中 Session 结束后移除 Agent 行状态", () => {
  const runtimes = { first: create_runtime("first", "streaming") };
  const current = { builder: "working" as const };
  const next = project_agent_chat_status(current, runtimes, "first", create_runtime("first", "completed"));
  assert.notEqual(next, current);
  assert.equal("builder" in next, false);
});

test("组合键内容不参与 Agent 行状态识别", () => {
  const runtime = create_runtime("session:with:separator", "submitted", "agent:with:separator");
  const next = project_agent_chat_status({}, {}, "workspace:unrelated:value", runtime);
  assert.equal(next["agent:with:separator"], "working");
});

test("批量移除多个 Session 后从剩余 runtime 重建 Agent 行状态", () => {
  const runtimes = {
    first: create_runtime("first", "streaming"),
    second: create_runtime("second", "waiting_input"),
    third: create_runtime("third", "completed", "reviewer"),
  };
  assert.deepEqual(collect_agent_chat_status(runtimes), { builder: "action_required" });
  assert.deepEqual(collect_agent_chat_status({}), {});
});

test("等待输入与正在工作被区分为两种实时状态", () => {
  assert.equal(resolve_chat_session_live_status(create_runtime("session", "waiting_input")), "action_required");
  assert.equal(resolve_chat_session_live_status(create_runtime("session", "submitted")), "working");
  assert.equal(resolve_chat_session_live_status(create_runtime("session", "streaming")), "working");
  assert.equal(resolve_chat_session_live_status(create_runtime("session", "completed")), null);
  assert.equal(resolve_chat_session_live_status(create_runtime("session", "failed")), null);
  assert.equal(resolve_chat_session_live_status(undefined), null);
});

test("Runtime 存在时覆盖目录快照里的旧执行标记", () => {
  assert.equal(resolve_chat_session_live_status(create_runtime("session", "completed"), true), null);
  assert.equal(resolve_chat_session_live_status(create_runtime("session", "waiting_input"), true), "action_required");
  assert.equal(resolve_chat_session_live_status(undefined, true), "working");
  assert.equal(resolve_chat_session_live_status(undefined, false), null);
});

test("同一 Agent 多个 Session 聚合时等待输入优先于正在工作", () => {
  const runtimes = {
    first: create_runtime("first", "streaming"),
    second: create_runtime("second", "waiting_input"),
  };
  assert.deepEqual(collect_agent_chat_status(runtimes), { builder: "action_required" });
});

test("等待中的 Session 恢复执行或结束时回退到另一个 Session 的状态", () => {
  const runtimes = {
    waiting: create_runtime("waiting", "waiting_input"),
    working: create_runtime("working", "streaming"),
  };
  const current = { builder: "action_required" as const };
  assert.equal(project_agent_chat_status(current, runtimes, "waiting", create_runtime("waiting", "streaming"))["builder"], "working");
  const ended = project_agent_chat_status(current, runtimes, "waiting", create_runtime("waiting", "completed"));
  assert.equal(ended["builder"], "working");
  const both_ended = project_agent_chat_status(current, { working: create_runtime("working", "completed") }, "waiting", create_runtime("waiting", "completed"));
  assert.equal("builder" in both_ended, false);
});
