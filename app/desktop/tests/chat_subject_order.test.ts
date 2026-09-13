/** Desktop Chat Sidebar 主体「最近活跃」排序投影测试。 */

import assert from "node:assert/strict";
import test from "node:test";
import type {
  DesktopAgentSummary,
  DesktopChatRuntime,
  DesktopGroupSummary,
  DesktopGroupSessionSummary,
  DesktopSessionSummary,
} from "../src/common/types/DesktopApi.ts";
import type { DesktopWorkspaceSession } from "../src/renderer/types/DesktopView.ts";
import {
  collect_agent_last_active,
  collect_group_last_active,
  merge_runtime_activity,
  order_chat_subjects,
} from "../src/renderer/features/navigation/lib/chat_subject_order.ts";

/** 创建满足排序需要的最小 Agent 摘要。 */
function create_agent(agent_id: string, name = agent_id): DesktopAgentSummary {
  return { agent_id, name, description: "", model_id: "model", version: "1.0.0" };
}

/** 创建满足排序需要的最小 Session 摘要。 */
function create_session(session_id: string, updated_at: number): DesktopSessionSummary {
  return {
    session_id,
    title: session_id,
    preview_text: "",
    created_at: updated_at,
    updated_at,
    message_count: 0,
    executing: false,
  };
}

/** 把 Session 摘要挂到执行 Agent 上，构成 Session 导航索引。 */
function create_entries(agent_id: string, sessions: Array<[string, number]>): DesktopWorkspaceSession[] {
  return sessions.map(([session_id, updated_at]) => ({
    agent_id,
    session: create_session(session_id, updated_at),
  }));
}

/** 创建满足排序需要的最小 GroupSession 摘要。 */
function create_group_session(session_id: string, updated_at: number): DesktopGroupSessionSummary {
  return { session_id, title: session_id, created_at: updated_at, updated_at, message_count: 0 };
}

/** 创建满足排序需要的最小 Group 摘要。 */
function create_group(group_id: string, name = group_id, sessions: DesktopGroupSessionSummary[] = []): DesktopGroupSummary {
  return { group_id, name, model_id: "model", members: [], message_count: 0, sessions };
}

/** 创建一条 Chat 运行态。 */
function create_runtime(agent_id: string, status: DesktopChatRuntime["status"], updated_at: number, turn_id?: string): DesktopChatRuntime {
  return {
    agent_id,
    workspace_id: "workspace",
    session_id: "session",
    status,
    updated_at,
    ...(turn_id ? { turn_id } : {}),
  };
}

/** 按排序结果投影主体标识，便于断言。 */
function subject_keys(subjects: ReturnType<typeof order_chat_subjects>): string[] {
  return subjects.map((subject) => subject.key);
}

test("Agent 取跨 Workspace 的最近一次对话时间", () => {
  const last_active = collect_agent_last_active({
    "project-a": create_entries("writer", [["one", 10]]),
    "project-b": create_entries("writer", [["two", 40]]),
  });

  assert.equal(last_active.writer, 40);
});

test("Agent 与 Group 合并到同一条时间轴", () => {
  const agents = [create_agent("writer"), create_agent("reviewer")];
  const groups = [create_group("studio", "studio", [create_group_session("round-1", 90)])];
  const sessions_by_workspace = {
    "project-a": [...create_entries("writer", [["one", 50]]), ...create_entries("reviewer", [["two", 10]])],
  };
  const subjects = order_chat_subjects({
    agents,
    groups,
    last_active_by_agent: collect_agent_last_active(sessions_by_workspace),
    last_active_by_group: collect_group_last_active(groups),
  });

  assert.deepEqual(subject_keys(subjects), ["group:studio", "agent:writer", "agent:reviewer"]);
});

test("从未对话的主体排在最后，且 Agent 先于 Group", () => {
  const agents = [create_agent("chatty"), create_agent("silent", "silent")];
  const groups = [create_group("quiet")];
  const subjects = order_chat_subjects({
    agents,
    groups,
    last_active_by_agent: { chatty: 20 },
    last_active_by_group: {},
  });

  assert.deepEqual(subject_keys(subjects), ["agent:chatty", "agent:silent", "group:quiet"]);
});

test("同一时间点用名称做末级排序，重复调用顺序一致", () => {
  const agents = [create_agent("z", "zeta"), create_agent("a", "alpha")];
  const input = {
    agents,
    groups: [],
    last_active_by_agent: { z: 30, a: 30 },
    last_active_by_group: {},
  };

  assert.deepEqual(subject_keys(order_chat_subjects(input)), ["agent:a", "agent:z"]);
  assert.deepEqual(subject_keys(order_chat_subjects(input)), subject_keys(order_chat_subjects(input)));
});

test("只有真正跑过 Turn 的运行态才算一次对话", () => {
  const base = { writer: 10 };

  assert.deepEqual(
    merge_runtime_activity(base, { stale: create_runtime("writer", "idle", 99) }),
    { writer: 10 },
  );
  assert.deepEqual(
    merge_runtime_activity(base, { opening: create_runtime("writer", "idle", 99, "turn-1") }),
    { writer: 99 },
  );
  assert.deepEqual(
    merge_runtime_activity(base, { live: create_runtime("writer", "streaming", 77) }),
    { writer: 77 },
  );
});

test("Group 取最新一条 GroupSession 的更新时间", () => {
  const last_active = collect_group_last_active([
    create_group("studio", "studio", [create_group_session("round-1", 30), create_group_session("round-2", 80)]),
    create_group("empty"),
  ]);

  assert.equal(last_active.studio, 80);
  assert.equal(last_active.empty, undefined);
});
