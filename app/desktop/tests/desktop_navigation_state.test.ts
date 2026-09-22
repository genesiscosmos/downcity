/** Desktop 页面导航状态恢复测试。 */

import assert from "node:assert/strict";
import test from "node:test";
import { get_group_chat_key } from "../src/renderer/features/chat/lib/chat_cache_key.ts";
import { get_sidebar_mode_for_navigation, get_sidebar_mode_for_target, is_restorable_navigation_target, parse_navigation_target, resolve_navigation_target } from "../src/renderer/features/navigation/lib/desktop_navigation_state.ts";
import type { DesktopNavigationCatalog } from "../src/renderer/types/DesktopNavigation.ts";
import { get_group_draft_session_id, is_group_draft_session_id } from "../src/renderer/types/DesktopView.ts";

const catalog: DesktopNavigationCatalog = {
  agents: [{ agent_id: "writer", name: "Writer", description: "", model_id: "model", powers: {}, created_at: "", updated_at: "" }],
  workspaces: [{ workspace_id: "project", workspace_path: "/project", name: "Project", readme: "", created_at: "", updated_at: "" }],
  groups: [{ group_id: "team", name: "Team", description: "", model_id: "model", member_ids: ["writer"], active_session_id: "group-session", sessions: [{ session_id: "group-session", workspace_id: "project", title: "Group", created_at: 1, updated_at: 1, message_count: 0 }], created_at: 1, updated_at: 1 }],
  powers: [{ power_id: "tasks", name: "Tasks", description: "", version: "1.0.0", source: "builtin", profiles: [], has_agent: false, has_main: true, has_renderer: true, has_config: false, has_sidebar: true, has_mainview: true }],
  sessions_by_workspace: { project: [{ agent_id: "writer", session: { session_id: "session", title: "Session", preview_text: "", created_at: 1, updated_at: 1, message_count: 0, executing: false } }] },
};

test("只解析结构完整的稳定页面", () => {
  assert.deepEqual(parse_navigation_target(JSON.stringify({ kind: "session", workspace_id: "project", agent_id: "writer", session_id: "session" })), { kind: "session", workspace_id: "project", agent_id: "writer", session_id: "session" });
  assert.equal(parse_navigation_target(JSON.stringify({ kind: "draft", workspace_id: "project", agent_id: "writer", draft_id: "draft" })), undefined);
  assert.equal(parse_navigation_target(JSON.stringify({ kind: "group_draft", workspace_id: "project", group_id: "team", draft_id: "group-draft:team" })), undefined);
  assert.equal(parse_navigation_target(JSON.stringify({ kind: "create_group" })), undefined);
  assert.equal(parse_navigation_target("invalid-json"), undefined);
});

test("Workspace 文件预览的行号可以被恢复，非法行号被忽略", () => {
  assert.deepEqual(parse_navigation_target(JSON.stringify({ kind: "workspace_file", workspace_id: "project", relative_path: "src/index.ts", line: 45 })), { kind: "workspace_file", workspace_id: "project", relative_path: "src/index.ts", line: 45 });
  assert.deepEqual(parse_navigation_target(JSON.stringify({ kind: "workspace_file", workspace_id: "project", relative_path: "src/index.ts", line: "45" })), { kind: "workspace_file", workspace_id: "project", relative_path: "src/index.ts" });
});

test("Group Draft 使用隔离键且不会进入持久化导航", () => {
  const draft_id = get_group_draft_session_id("team");
  assert.equal(draft_id, "group-draft:team");
  assert.equal(is_group_draft_session_id(draft_id), true);
  assert.notEqual(get_group_chat_key("project-a", "team", draft_id), get_group_chat_key("project-b", "team", draft_id));
  assert.equal(is_restorable_navigation_target({ kind: "group_draft", workspace_id: "project-a", group_id: "team", draft_id }), false);
});

test("存在的 Session 与 GroupSession 可以恢复", () => {
  assert.deepEqual(resolve_navigation_target({ kind: "session", workspace_id: "project", agent_id: "writer", session_id: "session" }, catalog), { kind: "session", workspace_id: "project", agent_id: "writer", session_id: "session" });
  assert.deepEqual(resolve_navigation_target({ kind: "group_session", group_id: "team", workspace_id: "project", session_id: "group-session" }, catalog), { kind: "group_session", group_id: "team", workspace_id: "project", session_id: "group-session" });
});

test("已删除的子资源逐级退回所属页面", () => {
  assert.deepEqual(resolve_navigation_target({ kind: "session", workspace_id: "project", agent_id: "writer", session_id: "missing" }, catalog), { kind: "agent", agent_id: "writer" });
  assert.deepEqual(resolve_navigation_target({ kind: "group_session", group_id: "team", workspace_id: "project", session_id: "missing" }, catalog), { kind: "group", group_id: "team" });
  assert.deepEqual(resolve_navigation_target({ kind: "power_workspace", power_id: "missing" }, catalog), { kind: "powers" });
});

test("一级侧栏由恢复目标唯一推导", () => {
  assert.equal(get_sidebar_mode_for_navigation({ kind: "workspace_file", workspace_id: "project", relative_path: "README.md" }), "workspace");
  assert.equal(get_sidebar_mode_for_navigation({ kind: "power_workspace", power_id: "tasks" }), "power:tasks");
  assert.equal(get_sidebar_mode_for_navigation({ kind: "agent", agent_id: "writer" }), "chat");
});

/**
 * 导航目标与侧栏的对应只有一份。
 *
 * 会话条目只长在 Works 树里，因此所有会话类目标都必须落 Works——把用户留在一张不列会话的
 * 面板上，他在侧栏里就找不到自己刚打开的那一条。此前导航入口硬编码 `"chat"`，而 `"chat"`
 * 是 Agents 面板，于是按 ⌘R 新建对话会把侧栏从 Works 拽走。
 */
test("会话类目标都落 Works，设置页不属于任何业务入口", () => {
  assert.equal(get_sidebar_mode_for_target({ kind: "session", workspace_id: "project", agent_id: "writer", session_id: "session" }), "workspace");
  assert.equal(get_sidebar_mode_for_target({ kind: "draft", workspace_id: "project", agent_id: "writer", draft_id: "draft" }), "workspace");
  assert.equal(get_sidebar_mode_for_target({ kind: "group_session", group_id: "team", workspace_id: "project", session_id: "group-session" }), "workspace");
  assert.equal(get_sidebar_mode_for_target({ kind: "group_draft", group_id: "team", workspace_id: "project", draft_id: "group-draft:team" }), "workspace");
  assert.equal(get_sidebar_mode_for_target({ kind: "settings", section: "shortcuts" }), undefined);
});
