/** Desktop Session 导航目录投影测试。 */

import assert from "node:assert/strict";
import test from "node:test";
import type { DesktopChatRuntime, DesktopGroupSessionSummary, DesktopGroupSummary, DesktopSessionSummary } from "../src/common/types/DesktopApi.ts";
import { get_session_key } from "../src/renderer/features/chat/lib/chat_cache_key.ts";
import { resolve_chat_session_live_status } from "../src/renderer/features/chat/lib/chat_runtime_projection.ts";
import {
  group_agent_sessions_by_workspace,
  resolve_agent_chat_target,
  select_workspace_session_entries,
} from "../src/renderer/features/chat/lib/session_list_projection.ts";

/** 创建满足导航列表需要的 Session 摘要。 */
function create_session(session_id: string, workspace_id: string, updated_at: number, executing = false): DesktopSessionSummary {
  return {
    session_id,
    workspace_id,
    title: session_id,
    preview_text: "",
    created_at: updated_at,
    updated_at,
    message_count: 0,
    executing,
  };
}

/** 创建满足导航列表需要的 GroupSession 摘要。 */
function create_group_session(session_id: string, workspace_id: string | undefined, updated_at: number): DesktopGroupSessionSummary {
  return { session_id, workspace_id, title: session_id, created_at: updated_at, updated_at, message_count: 0 };
}

/** 创建带会话的 Group 摘要。 */
function create_group(group_id: string, sessions: DesktopGroupSessionSummary[]): DesktopGroupSummary {
  return { group_id, name: group_id, model_id: "model", members: [], message_count: 0, sessions };
}

/** 投影一个 Workspace 的会话，Agent 侧不解析实时状态、Group 侧一律 idle。 */
function select_entries(options: {
  /** Agent Session 目录。 */ sessions_by_workspace: Record<string, DesktopSessionSummary[]>;
  /** 全部 Group。 */ groups?: DesktopGroupSummary[];
  /** 目标 Workspace。 */ workspace_id: string;
  /** Agent 侧的实时状态解析。 */ resolve_agent_live_status?: (workspace_id: string, agent_id: string, session: DesktopSessionSummary) => ReturnType<typeof resolve_chat_session_live_status>;
}) {
  return select_workspace_session_entries({
    sessions_by_workspace: options.sessions_by_workspace as never,
    groups: options.groups ?? [],
    workspace_id: options.workspace_id,
    resolve_agent_live_status: options.resolve_agent_live_status ?? ((_workspace_id, _agent_id, session) => session.executing ? "working" : null),
    resolve_group_live_status: () => null,
  });
}

test("按 Session 自身 Workspace 归属构建完整目录", () => {
  const grouped_sessions = group_agent_sessions_by_workspace([
    { agent_id: "writer", sessions: [create_session("one", "project-a", 1), create_session("two", "project-b", 2)] },
    { agent_id: "reviewer", sessions: [create_session("three", "project-a", 3)] },
  ]);

  assert.deepEqual(Object.keys(grouped_sessions).sort(), ["project-a", "project-b"]);
  assert.deepEqual(grouped_sessions["project-a"].map((entry) => entry.agent_id), ["writer", "reviewer"]);
});

test("实时 Runtime 覆盖 Session 目录中的旧执行状态", () => {
  const sessions_by_workspace = group_agent_sessions_by_workspace([
    { agent_id: "writer", sessions: [create_session("stale-running", "project-a", 20, true), create_session("now-running", "project-a", 10)] },
  ]);
  const create_runtime = (session_id: string, status: DesktopChatRuntime["status"]): DesktopChatRuntime => ({
    agent_id: "writer",
    workspace_id: "project-a",
    session_id,
    status,
    updated_at: 30,
  });
  const runtimes = {
    [get_session_key("project-a", "writer", "stale-running")]: create_runtime("stale-running", "completed"),
    [get_session_key("project-a", "writer", "now-running")]: create_runtime("now-running", "streaming"),
  };

  const entries = select_entries({
    sessions_by_workspace,
    workspace_id: "project-a",
    resolve_agent_live_status: (workspace_id, _agent_id, session) => {
      const runtime = runtimes[get_session_key(workspace_id, "writer", session.session_id)];
      return resolve_chat_session_live_status(runtime, session.executing);
    },
  });

  assert.deepEqual(entries.map((entry) => [entry.session.session_id, entry.live_status]), [
    ["now-running", "working"],
    ["stale-running", null],
  ]);
});

test("等待输入的 Session 优先排序并单独标记", () => {
  const sessions_by_workspace = group_agent_sessions_by_workspace([
    { agent_id: "writer", sessions: [create_session("recent-idle", "project-a", 30), create_session("waiting", "project-a", 10)] },
  ]);
  const runtimes = {
    [get_session_key("project-a", "writer", "waiting")]: {
      agent_id: "writer",
      workspace_id: "project-a",
      session_id: "waiting",
      status: "waiting_input" as const,
      updated_at: 30,
    },
  };

  const entries = select_entries({
    sessions_by_workspace,
    workspace_id: "project-a",
    resolve_agent_live_status: (workspace_id, _agent_id, session) =>
      resolve_chat_session_live_status(runtimes[get_session_key(workspace_id, "writer", session.session_id)], session.executing),
  });

  assert.deepEqual(entries.map((entry) => [entry.session.session_id, entry.live_status]), [
    ["waiting", "action_required"],
    ["recent-idle", null],
  ]);
});

test("投影只取目标 Workspace 的会话，且优先显示执行中 Session", () => {
  const sessions_by_workspace = group_agent_sessions_by_workspace([
    { agent_id: "writer", sessions: [create_session("older", "project-a", 10), create_session("running", "project-b", 5, true)] },
    { agent_id: "reviewer", sessions: [create_session("other-agent", "project-a", 20)] },
  ]);

  const entries = select_entries({ sessions_by_workspace, workspace_id: "project-a" });

  assert.deepEqual(entries.map((entry) => entry.session.session_id), ["other-agent", "older"]);
});

test("Agent Session 与 GroupSession 落在同一条时间轴上", () => {
  const sessions_by_workspace = group_agent_sessions_by_workspace([
    { agent_id: "writer", sessions: [create_session("agent-newer", "project-a", 30), create_session("agent-older", "project-a", 10)] },
  ]);

  const entries = select_entries({
    sessions_by_workspace,
    workspace_id: "project-a",
    groups: [
      create_group("team", [create_group_session("group-middle", "project-a", 20)]),
      // 别的 Workspace 的群聊不能混进来：Works 树是按 Workspace 切的。
      create_group("other", [create_group_session("group-elsewhere", "project-b", 99)]),
    ],
  });

  assert.deepEqual(entries.map((entry) => entry.session.session_id), ["agent-newer", "group-middle", "agent-older"]);
});

test("Group 会话带上归属标识与稳定 key", () => {
  const entries = select_entries({
    sessions_by_workspace: {},
    workspace_id: "project-a",
    groups: [create_group("team", [create_group_session("group-one", "project-a", 1)])],
  });

  assert.equal(entries.length, 1);
  const [entry] = entries;
  assert.equal(entry.kind, "group");
  assert.equal(entry.key, "group:team:group-one");
  assert.equal(entry.kind === "group" ? entry.group_id : "", "team");
  assert.equal(entry.workspace_id, "project-a");
});

test("未绑定的 GroupSession 不进入任何 Workspace", () => {
  const entries = select_entries({
    sessions_by_workspace: {},
    workspace_id: "project-a",
    groups: [create_group("team", [create_group_session("unbound", undefined, 1)])],
  });

  assert.deepEqual(entries, []);
});

test("Agent 主体入口优先恢复最近打开的 Session，而不是最近更新的 Session", () => {
  const sessions_by_workspace = group_agent_sessions_by_workspace([
    { agent_id: "writer", sessions: [create_session("last-opened", "project-a", 10), create_session("latest-updated", "project-b", 20)] },
  ]);

  const target = resolve_agent_chat_target(sessions_by_workspace, new Set(["project-a", "project-b"]), "writer", {
    kind: "session",
    workspace_id: "project-a",
    agent_id: "writer",
    session_id: "last-opened",
  });

  assert.deepEqual(target, { kind: "session", workspace_id: "project-a", agent_id: "writer", session_id: "last-opened" });
});

test("最近打开目标失效后回退到最近更新的 Session", () => {
  const sessions_by_workspace = group_agent_sessions_by_workspace([
    { agent_id: "writer", sessions: [create_session("older", "project-a", 10), create_session("latest", "project-b", 20)] },
  ]);

  const target = resolve_agent_chat_target(sessions_by_workspace, new Set(["project-a", "project-b"]), "writer", {
    kind: "session",
    workspace_id: "project-a",
    agent_id: "writer",
    session_id: "removed",
  });

  assert.deepEqual(target, { kind: "session", workspace_id: "project-b", agent_id: "writer", session_id: "latest" });
});

test("Agent 主体入口可以恢复最近打开的 Draft", () => {
  const target = resolve_agent_chat_target({}, new Set(["project-a"]), "writer", {
    kind: "draft",
    workspace_id: "project-a",
    agent_id: "writer",
    draft_id: "draft:writer",
  });

  assert.deepEqual(target, { kind: "draft", workspace_id: "project-a", agent_id: "writer", draft_id: "draft:writer" });
});
