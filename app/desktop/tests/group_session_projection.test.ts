/** GroupSession canonical title 的 Renderer 投影测试。 */

import assert from "node:assert/strict";
import test from "node:test";
import { update_group_session_title, update_group_session_title_index } from "../src/renderer/lib/group/group_session_projection.ts";
import { same_group_member_statuses } from "../src/renderer/lib/group/group_runtime_projection.ts";
import type { DesktopGroupSummary } from "../src/common/types/DesktopApi.ts";
import type { DesktopViewController } from "../src/renderer/types/DesktopView.ts";

const group: DesktopGroupSummary = {
  group_id: "delivery",
  name: "Delivery",
  model_id: "model",
  members: [{ agent_id: "builder" }],
  message_count: 2,
  active_session_id: "session-a",
  sessions: [
    { session_id: "session-a", title: "旧标题", workspace_id: "workspace-a", preview_text: "最后一条回复", created_at: 1, updated_at: 2, message_count: 2 },
    { session_id: "session-b", title: "保持不变", workspace_id: "workspace-b", preview_text: "另一条回复", created_at: 3, updated_at: 4, message_count: 2 },
  ],
};

test("GroupSession title 更新不会改写 preview_text", () => {
  const updated = update_group_session_title(group, "delivery", "session-a", "新标题");
  assert.equal(updated.sessions[0].title, "新标题");
  assert.equal(updated.sessions[0].preview_text, "最后一条回复");
  assert.equal(updated.sessions[1], group.sessions[1]);
});

test("非当前 GroupSession 的 title 事件也会同步到 Workspace 索引", () => {
  const current: DesktopViewController["group_sessions_by_workspace"] = {
    "workspace-a": [{ group_id: group.group_id, group, session: group.sessions[0] }],
    "workspace-b": [{ group_id: group.group_id, group, session: group.sessions[1] }],
  };
  const updated = update_group_session_title_index(current, "delivery", "session-b", "后台生成标题");
  assert.equal(updated["workspace-a"][0].group.sessions[1].title, "后台生成标题");
  assert.equal(updated["workspace-b"][0].session.title, "后台生成标题");
  assert.equal(updated["workspace-b"][0].session.preview_text, "另一条回复");
});

test("Group 成员运行态只在有序字段实际变化时失效", () => {
  const current = [{ agent_id: "builder", running: true }, { agent_id: "reviewer", running: false }];
  assert.equal(same_group_member_statuses(current, current), true);
  assert.equal(same_group_member_statuses(current, current.map((status) => ({ ...status }))), true);
  assert.equal(same_group_member_statuses(current, [...current].reverse()), false);
  assert.equal(same_group_member_statuses(current, [{ ...current[0], running: false }, current[1]]), false);
});
