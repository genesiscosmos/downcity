/** Group 行实时状态与运行阶段规则测试。 */

import assert from "node:assert/strict";
import test from "node:test";
import {
  is_group_phase_running,
  resolve_group_chat_live_status,
  same_group_member_statuses,
} from "../src/renderer/features/chat/lib/group/group_runtime_projection.ts";

test("只有推进中的运行阶段算占用运行槽", () => {
  for (const phase of ["dispatching", "dispatched", "executing"] as const) {
    assert.equal(is_group_phase_running(phase), true, `${phase} 应视为运行中`);
  }
  for (const phase of ["idle", "stopped", "failed", undefined] as const) {
    assert.equal(is_group_phase_running(phase), false, `${phase} 不应视为运行中`);
  }
});

test("存在待响应交互时行状态是等待用户，而不是仍在推进", () => {
  // 成员等待用户回答时 Group 阶段仍是 executing，但用户此刻该做的是作答。
  assert.equal(resolve_group_chat_live_status({ has_pending_interaction: true, running: true }), "action_required");
  assert.equal(resolve_group_chat_live_status({ has_pending_interaction: true, running: false }), "action_required");
});

test("没有待响应交互时按运行阶段给出推进状态", () => {
  assert.equal(resolve_group_chat_live_status({ has_pending_interaction: false, running: true }), "working");
  assert.equal(resolve_group_chat_live_status({ has_pending_interaction: false, running: false }), null);
});

test("成员运行态比较按顺序与内容判定，相同内容保留原引用", () => {
  const members = [{ agent_id: "builder", running: true }];
  assert.equal(same_group_member_statuses(members, members), true);
  assert.equal(same_group_member_statuses(members, [{ agent_id: "builder", running: true }]), true);
  assert.equal(same_group_member_statuses(members, [{ agent_id: "builder", running: false }]), false);
  assert.equal(same_group_member_statuses(members, [{ agent_id: "reviewer", running: true }]), false);
  assert.equal(same_group_member_statuses(undefined, []), false);
});
