/** Desktop Notification 聚合、已读与 Session 完成生产者测试。 */

import assert from "node:assert/strict";
import test from "node:test";
import type { DesktopNotification } from "../src/common/types/DesktopNotification.ts";
import { NotificationController } from "../src/main/notification/NotificationController.ts";
import { NotificationStore } from "../src/main/notification/NotificationStore.ts";
import { SessionTurnNotificationProducer } from "../src/main/notification/SessionTurnNotificationProducer.ts";
import { GroupNotificationProducer } from "../src/main/notification/GroupNotificationProducer.ts";
import { PowerNotificationProducer } from "../src/main/notification/PowerNotificationProducer.ts";
import {
  get_agent_unread_attention,
  get_chat_unread_attention,
  get_group_session_unread_attention,
  get_group_unread_attention,
  has_unread_power_notification,
  notification_target_from_navigation,
  power_renderer_notifications,
} from "../src/renderer/lib/notification/notification_state.ts";

/** 创建一组完全内存化的 NotificationController 测试依赖。 */
function create_fixture(initial: DesktopNotification[] = []) {
  let stored = [...initial];
  const badge_counts: number[] = [];
  const states: ReturnType<NotificationController["get_state"]>[] = [];
  let next_id = 0;
  const controller = new NotificationController(
    {
      read: () => [...stored],
      write: (notifications) => { stored = [...notifications]; },
    },
    { update: (unread_count) => { badge_counts.push(unread_count); } },
    { state_changed: (state) => { states.push(state); } },
    { create_id: () => `notification-${++next_id}` },
  );
  return { controller, badge_counts, states, read_stored: () => stored };
}

const target = {
  kind: "agent_session" as const,
  agent_id: "writer",
  workspace_id: "workspace",
  session_id: "session",
};
const agent_scope = [{ kind: "agent" as const, agent_id: "writer" }];
const group_target = { kind: "group_session" as const, group_id: "crew", session_id: "group-session" };
const group_scope = [{ kind: "group" as const, group_id: "crew" }];
/** 构造一条 Group 成员 Agent 的待响应交互事件。 */
function create_group_interaction(interaction_id: string) {
  return {
    type: "interaction" as const,
    group_id: "crew",
    session_id: "group-session",
    agent_id: "writer",
    request: {
      interaction_id,
      turn_id: "turn-1",
      type: "confirmation",
      source: { type: "tool" as const },
      payload: {},
      created_at: 1,
    },
  };
}

test("相同 topic 的多次完成只保留最新一条未读通知", () => {
  const fixture = create_fixture();
  fixture.controller.publish({ kind: "session_turn_completed", topic_key: "session:writer", target, scopes: agent_scope, title: "第一次完成", created_at: 1 });
  fixture.controller.publish({ kind: "session_turn_completed", topic_key: "session:writer", target, scopes: agent_scope, title: "第二次完成", created_at: 2 });

  assert.equal(fixture.controller.get_state().unread_count, 1);
  assert.equal(fixture.controller.get_state().notifications[0]?.title, "第二次完成");
  assert.equal(fixture.controller.get_state().notifications[0]?.notification_id, "notification-1");
  assert.equal(fixture.read_stored().length, 1);
  assert.deepEqual(fixture.badge_counts, [0, 1, 1]);
});

test("正在前台查看的目标完成时不会产生未读", () => {
  const fixture = create_fixture();
  fixture.controller.set_view_state(7, { target, visible: true });
  const published = fixture.controller.publish({ kind: "session_turn_completed", topic_key: "session:writer", target, scopes: agent_scope, title: "已完成", created_at: 1 });

  assert.equal(published, null);
  assert.equal(fixture.controller.get_state().unread_count, 0);
  assert.deepEqual(fixture.badge_counts, [0]);
});

test("打开未读目标后统一持久化已读并清除角标", () => {
  const fixture = create_fixture();
  fixture.controller.publish({ kind: "session_turn_completed", topic_key: "session:writer", target, scopes: agent_scope, title: "已完成", created_at: 1 });
  fixture.controller.set_view_state(7, { target, visible: true });

  assert.equal(fixture.controller.get_state().unread_count, 0);
  assert.equal(fixture.read_stored().length, 0);
  assert.deepEqual(fixture.badge_counts, [0, 1, 0]);
  assert.equal(fixture.states.at(-1)?.revision, 2);
});

test("Session Turn 生产者对等待输入、失败和完成都产生通知", () => {
  const fixture = create_fixture();
  const producer = new SessionTurnNotificationProducer(fixture.controller);
  const base = { agent_id: "writer", workspace_id: "workspace", session_id: "session", turn_id: "turn-1", updated_at: 10 };

  producer.handle_runtime({ ...base, status: "waiting_input" });
  assert.equal(fixture.controller.get_state().notifications[0]?.kind, "session_turn_waiting_input");

  producer.handle_runtime({ ...base, status: "failed" });
  assert.equal(fixture.controller.get_state().unread_count, 1);
  assert.equal(fixture.controller.get_state().notifications[0]?.kind, "session_turn_failed");
});

test("Session Turn 生产者按 Turn 去重并阻止终态回退", () => {
  const fixture = create_fixture();
  const producer = new SessionTurnNotificationProducer(fixture.controller);
  const runtime = {
    agent_id: "writer",
    workspace_id: "workspace",
    session_id: "session",
    status: "completed" as const,
    turn_id: "turn-1",
    updated_at: 10,
  };

  producer.handle_runtime(runtime);
  producer.handle_runtime(runtime);
  // 迟到的等待输入收口事件不能把已完成通知回退成等待输入。
  producer.handle_runtime({ ...runtime, status: "waiting_input", updated_at: 20 });

  assert.equal(fixture.controller.get_state().unread_count, 1);
  assert.equal(fixture.controller.get_state().notifications[0]?.kind, "session_turn_completed");
  assert.deepEqual(fixture.badge_counts, [0, 1]);
});

test("Session 重新进入运行态会收回尚未查看的等待输入通知", () => {
  const fixture = create_fixture();
  const producer = new SessionTurnNotificationProducer(fixture.controller);
  const waiting = {
    agent_id: "writer",
    workspace_id: "workspace",
    session_id: "session",
    status: "waiting_input" as const,
    turn_id: "turn-1",
    updated_at: 10,
  };

  producer.handle_runtime(waiting);
  assert.equal(fixture.controller.get_state().unread_count, 1);
  producer.handle_runtime({ ...waiting, status: "streaming", updated_at: 20 });
  assert.equal(fixture.controller.get_state().unread_count, 0);
});

test("同一 Session 的不同落点聚合为一条未读通知", () => {
  const fixture = create_fixture();
  const producer = new SessionTurnNotificationProducer(fixture.controller);
  const base = { agent_id: "writer", workspace_id: "workspace", session_id: "session", updated_at: 10 };

  producer.handle_runtime({ ...base, status: "failed", turn_id: "turn-1" });
  producer.handle_runtime({ ...base, status: "completed", turn_id: "turn-2", updated_at: 20 });

  assert.equal(fixture.controller.get_state().unread_count, 1);
  assert.equal(fixture.controller.get_state().notifications[0]?.kind, "session_turn_completed");
});

test("NotificationStore 过滤损坏记录并原子写回未读集合", () => {
  let stored: unknown = [
    {
      notification_id: "valid",
      kind: "session_turn_completed",
      topic_key: "session:writer",
      target,
      scopes: agent_scope,
      title: "已完成",
      created_at: 1,
    },
    {
      notification_id: "waiting",
      kind: "session_turn_waiting_input",
      topic_key: "session:writer:waiting",
      target,
      scopes: agent_scope,
      title: "等待输入",
      created_at: 2,
    },
    { notification_id: "broken", kind: "unknown" },
  ];
  const store = new NotificationStore({
    get: () => stored,
    set: (_key: string, value: unknown) => { stored = value; },
    remove: () => undefined,
  } as never);

  assert.deepEqual(store.read().map((notification) => notification.notification_id), ["valid", "waiting"]);
  store.write([]);
  assert.deepEqual(stored, []);
});

test("Renderer 按 Agent 聚合并按 Session 精确查询未读注意力", () => {
  const fixture = create_fixture();
  fixture.controller.publish({ kind: "session_turn_completed", topic_key: "session:writer", target, scopes: agent_scope, title: "已完成", created_at: 1 });
  const state = fixture.controller.get_state();

  assert.equal(get_agent_unread_attention(state, "writer"), "completed");
  assert.equal(get_chat_unread_attention(state), "completed");
  assert.equal(get_group_unread_attention(state, "writer"), null);
  assert.deepEqual(notification_target_from_navigation({ kind: "session", workspace_id: "workspace", agent_id: "writer", session_id: "session" }), target);
  assert.equal(notification_target_from_navigation({ kind: "agent", agent_id: "writer" }), undefined);
});

test("聚合未读时优先展示最需要用户处理的落点", () => {
  const fixture = create_fixture();
  fixture.controller.publish({ kind: "session_turn_completed", topic_key: "session:done", target, scopes: agent_scope, title: "已完成", created_at: 1 });
  fixture.controller.publish({ kind: "session_turn_failed", topic_key: "session:failed", target, scopes: agent_scope, title: "执行失败", created_at: 2 });
  assert.equal(get_agent_unread_attention(fixture.controller.get_state(), "writer"), "failed");

  fixture.controller.publish({ kind: "session_turn_waiting_input", topic_key: "session:waiting", target, scopes: agent_scope, title: "等待输入", created_at: 3 });
  assert.equal(get_agent_unread_attention(fixture.controller.get_state(), "writer"), "action_required");
  assert.equal(get_chat_unread_attention(fixture.controller.get_state()), "action_required");
});

test("Chat 一级导航汇总 Session 与 Group 未读通知", () => {
  const fixture = create_fixture();
  const producer = new PowerNotificationProducer(fixture.controller);
  producer.publish("task", { topic_key: "global", title: "Power 完成", route: {} });

  assert.equal(get_chat_unread_attention(fixture.controller.get_state()), null);
  fixture.controller.publish({ kind: "session_turn_completed", topic_key: "session:writer", target, scopes: agent_scope, title: "Session 完成", created_at: 1 });
  assert.equal(get_chat_unread_attention(fixture.controller.get_state()), "completed");

  fixture.controller.mark_target_read(target);
  assert.equal(get_chat_unread_attention(fixture.controller.get_state()), null);

  fixture.controller.publish({ kind: "group_interaction_pending", topic_key: "group_session:crew:group-session", target: group_target, scopes: group_scope, title: "群聊等待你的输入", created_at: 2 });
  assert.equal(get_chat_unread_attention(fixture.controller.get_state()), "action_required");
  assert.equal(get_group_unread_attention(fixture.controller.get_state(), "crew"), "action_required");
  assert.equal(get_group_session_unread_attention(fixture.controller.get_state(), "crew", "group-session"), "action_required");
  assert.equal(get_group_session_unread_attention(fixture.controller.get_state(), "crew", "other"), null);
  assert.deepEqual(notification_target_from_navigation({ kind: "group_session", group_id: "crew", workspace_id: "workspace", session_id: "group-session" }), group_target);
});

test("Power 发布由宿主绑定身份并按本地 topic 聚合", () => {
  const fixture = create_fixture();
  const producer = new PowerNotificationProducer(fixture.controller);
  producer.publish("task", { topic_key: "agent:writer:task:daily", title: "第一次完成", route: { agent_id: "writer", task_title: "daily", view: "run", run_timestamp: "first" } });
  producer.publish("task", { topic_key: "agent:writer:task:daily", title: "第二次完成", route: { agent_id: "writer", task_title: "daily", view: "run", run_timestamp: "second" } });

  const state = fixture.controller.get_state();
  assert.equal(state.unread_count, 1);
  assert.equal(state.notifications[0]?.topic_key, "power:task:agent:writer:task:daily");
  assert.equal(has_unread_power_notification(state, "task"), true);
  assert.deepEqual(power_renderer_notifications(state, "task"), [{
    topic_key: "agent:writer:task:daily",
    title: "第二次完成",
    route: { agent_id: "writer", task_title: "daily", view: "run", run_timestamp: "second" },
    created_at: state.notifications[0]?.created_at,
  }]);
});

test("Power 路由只有完全可见时才收口已读", () => {
  const fixture = create_fixture();
  const producer = new PowerNotificationProducer(fixture.controller);
  const unread_route = { agent_id: "writer", task_title: "daily", view: "run", run_timestamp: "run-1" };
  producer.publish("task", { topic_key: "agent:writer:task:daily", title: "已完成", route: unread_route });

  fixture.controller.set_view_state(7, { target: { kind: "power", power_id: "task", route: { task_title: "daily", agent_id: "writer" } }, visible: true });
  assert.equal(fixture.controller.get_state().unread_count, 1);
  fixture.controller.set_view_state(7, { target: { kind: "power", power_id: "task", route: { ...unread_route } }, visible: true });
  assert.equal(fixture.controller.get_state().unread_count, 0);
  assert.deepEqual(notification_target_from_navigation(
    { kind: "power_workspace", power_id: "task" },
    { task: unread_route },
  ), { kind: "power", power_id: "task", route: unread_route });
});

test("Power 可以清除自身命名空间内的一个未读主题", () => {
  const fixture = create_fixture();
  const producer = new PowerNotificationProducer(fixture.controller);
  producer.publish("task", { topic_key: "agent:writer:task:daily", title: "已完成", route: {} });
  producer.dismiss("task", "agent:writer:task:daily");
  assert.equal(fixture.controller.get_state().unread_count, 0);
});

test("结构化目标键不会因业务 ID 包含分隔符而碰撞", () => {
  const fixture = create_fixture();
  const first_target = { kind: "agent_session" as const, agent_id: "a:b", workspace_id: "c", session_id: "d" };
  const second_target = { kind: "agent_session" as const, agent_id: "a", workspace_id: "b:c", session_id: "d" };
  fixture.controller.publish({ kind: "session_turn_completed", topic_key: "first", target: first_target, scopes: [{ kind: "agent", agent_id: "a:b" }], title: "first", created_at: 1 });
  fixture.controller.publish({ kind: "session_turn_completed", topic_key: "second", target: second_target, scopes: [{ kind: "agent", agent_id: "a" }], title: "second", created_at: 2 });

  fixture.controller.mark_target_read(first_target);

  assert.deepEqual(fixture.controller.get_state().notifications.map((notification) => notification.topic_key), ["second"]);
});

test("Agent 生命周期结束会清理 Session 与 Power 执行范围通知", () => {
  const fixture = create_fixture();
  const producer = new PowerNotificationProducer(fixture.controller);
  fixture.controller.publish({ kind: "session_turn_completed", topic_key: "session", target, scopes: agent_scope, title: "session", created_at: 1 });
  producer.publish("task", { topic_key: "agent:writer:task:daily", title: "task", route: {} }, "writer");
  producer.publish("task", { topic_key: "global", title: "global", route: {} });

  fixture.controller.mark_scope_read({ kind: "agent", agent_id: "writer" });

  assert.deepEqual(fixture.controller.get_state().notifications.map((notification) => notification.topic_key), ["power:task:global"]);
});

test("Group 成员等待输入时产生未读，并回到空闲后收回", () => {
  const fixture = create_fixture();
  const producer = new GroupNotificationProducer(fixture.controller);
  const interaction = create_group_interaction("interaction-1");

  producer.handle_event(interaction);
  assert.equal(fixture.controller.get_state().notifications[0]?.kind, "group_interaction_pending");
  assert.equal(get_group_session_unread_attention(fixture.controller.get_state(), "crew", "group-session"), "action_required");

  // 同一交互重复到达不再重复打扰。
  producer.handle_event(interaction);
  assert.equal(fixture.controller.get_state().unread_count, 1);

  producer.handle_event({ type: "status", group_id: "crew", session_id: "group-session", turn_id: "turn-1", phase: "executing", members: [] });
  assert.equal(fixture.controller.get_state().unread_count, 1);

  producer.handle_event({ type: "status", group_id: "crew", session_id: "group-session", turn_id: "turn-1", phase: "idle", members: [] });
  assert.equal(fixture.controller.get_state().unread_count, 0);
});

test("Group 执行失败产生未读，且下一轮等待输入会取代它", () => {
  const fixture = create_fixture();
  const producer = new GroupNotificationProducer(fixture.controller);

  producer.handle_event({ type: "status", group_id: "crew", session_id: "group-session", turn_id: "turn-1", phase: "failed", members: [] });
  producer.handle_event({ type: "status", group_id: "crew", session_id: "group-session", turn_id: "turn-1", phase: "failed", members: [] });
  assert.equal(fixture.controller.get_state().unread_count, 1);
  assert.equal(fixture.controller.get_state().notifications[0]?.kind, "group_turn_failed");
  assert.equal(get_group_unread_attention(fixture.controller.get_state(), "crew"), "failed");

  // 失败后回到空闲不能抹掉失败通知，必须等用户查看。
  producer.handle_event({ type: "status", group_id: "crew", session_id: "group-session", phase: "idle", members: [] });
  assert.equal(fixture.controller.get_state().unread_count, 1);

  producer.handle_event(create_group_interaction("interaction-2"));
  assert.equal(fixture.controller.get_state().unread_count, 1);
  assert.equal(fixture.controller.get_state().notifications[0]?.kind, "group_interaction_pending");
});

test("Group 删除后清理其全部 GroupSession 通知", () => {
  const fixture = create_fixture();
  const producer = new GroupNotificationProducer(fixture.controller);
  producer.handle_event(create_group_interaction("interaction-1"));
  fixture.controller.publish({ kind: "session_turn_completed", topic_key: "session:writer", target, scopes: agent_scope, title: "已完成", created_at: 1 });

  fixture.controller.mark_scope_read({ kind: "group", group_id: "crew" });

  assert.deepEqual(fixture.controller.get_state().notifications.map((notification) => notification.topic_key), ["session:writer"]);
});

test("GroupSession 通知可以持久化恢复", () => {
  const stored: unknown = [
    { notification_id: "group", kind: "group_interaction_pending", topic_key: "group_session:crew:group-session", target: group_target, scopes: group_scope, title: "群聊等待你的输入", created_at: 3 },
  ];
  const store = new NotificationStore({
    get: () => stored,
    set: () => undefined,
    remove: () => undefined,
  } as never);

  assert.deepEqual(store.read().map((notification) => notification.kind), ["group_interaction_pending"]);
});
