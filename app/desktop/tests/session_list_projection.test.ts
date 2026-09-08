/** Desktop Session 导航目录投影测试。 */

import assert from "node:assert/strict";
import test from "node:test";
import type { DesktopChatRuntime, DesktopSessionSummary } from "../src/common/types/DesktopApi.ts";
import { get_session_key } from "../src/renderer/features/chat/lib/chat_cache_key.ts";
import {
  group_agent_sessions_by_workspace,
  select_agent_sessions,
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

  const selected_sessions = select_agent_sessions(sessions_by_workspace, "writer", (workspace_id, session) => {
    const runtime = runtimes[get_session_key(workspace_id, "writer", session.session_id)];
    return runtime?.status === "streaming";
  });

  assert.deepEqual(selected_sessions.map(({ session, executing }) => [session.session_id, executing]), [
    ["now-running", true],
    ["stale-running", false],
  ]);
});

test("所选 Agent 的列表跨 Workspace 汇总并优先显示执行中 Session", () => {
  const sessions_by_workspace = group_agent_sessions_by_workspace([
    { agent_id: "writer", sessions: [create_session("older", "project-a", 10), create_session("running", "project-b", 5, true)] },
    { agent_id: "reviewer", sessions: [create_session("other-agent", "project-a", 20)] },
  ]);

  const selected_sessions = select_agent_sessions(sessions_by_workspace, "writer");

  assert.deepEqual(selected_sessions.map(({ workspace_id, session }) => [workspace_id, session.session_id]), [
    ["project-b", "running"],
    ["project-a", "older"],
  ]);
});
