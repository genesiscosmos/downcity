/** Desktop Chat 跨 Session 运行态聚合测试。 */

import assert from "node:assert/strict";
import test from "node:test";
import type { DesktopChatRuntime } from "../src/common/types/DesktopApi.ts";
import { collect_executing_agent_ids, project_executing_agent_ids } from "../src/renderer/lib/chat/chat_runtime_projection.ts";

function create_runtime(session_id: string, status: DesktopChatRuntime["status"], agent_id = "builder"): DesktopChatRuntime {
  return { agent_id, workspace_id: "workspace", session_id, status, updated_at: 1 };
}

test("一个 Session 结束时保留同 Agent 的其它运行中 Session", () => {
  const runtimes = {
    first: create_runtime("first", "streaming"),
    second: create_runtime("second", "streaming"),
  };
  const current = new Set(["builder"]);
  assert.equal(project_executing_agent_ids(current, runtimes, "first", create_runtime("first", "completed")), current);
  assert.equal(project_executing_agent_ids(current, runtimes, "first"), current);
});

test("最后一个运行中 Session 结束后移除 Agent", () => {
  const runtimes = { first: create_runtime("first", "streaming") };
  const current = new Set(["builder"]);
  const next = project_executing_agent_ids(current, runtimes, "first", create_runtime("first", "completed"));
  assert.notEqual(next, current);
  assert.equal(next.has("builder"), false);
});

test("组合键内容不参与 Agent 运行态识别", () => {
  const current = new Set<string>();
  const runtime = create_runtime("session:with:separator", "submitted", "agent:with:separator");
  const next = project_executing_agent_ids(current, {}, "workspace:unrelated:value", runtime);
  assert.equal(next.has("agent:with:separator"), true);
});

test("批量移除多个 Session 后从剩余 runtime 重建 Agent 集合", () => {
  const runtimes = {
    first: create_runtime("first", "streaming"),
    second: create_runtime("second", "waiting_input"),
    third: create_runtime("third", "completed", "reviewer"),
  };
  assert.deepEqual([...collect_executing_agent_ids(runtimes)], ["builder"]);
  assert.equal(collect_executing_agent_ids({}).size, 0);
});
