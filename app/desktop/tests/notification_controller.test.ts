/** Desktop Notification 聚合、已读与 Session 完成生产者测试。 */

import assert from "node:assert/strict";
import test from "node:test";
import type { DesktopNotification } from "../src/common/types/DesktopNotification.ts";
import { NotificationController } from "../src/main/notification/NotificationController.ts";
import { NotificationStore } from "../src/main/notification/NotificationStore.ts";
import { SessionTurnNotificationProducer } from "../src/main/notification/SessionTurnNotificationProducer.ts";
import { PluginNotificationProducer } from "../src/main/notification/PluginNotificationProducer.ts";
import {
  has_unread_agent_notification,
  has_unread_chat_notification,
  has_unread_plugin_notification,
  has_unread_session_notification,
  notification_target_from_navigation,
  plugin_renderer_notifications,
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

test("Session Turn 生产者忽略失败和重复完成事件", () => {
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

  producer.handle_runtime({ ...runtime, status: "failed" });
  producer.handle_runtime(runtime);
  producer.handle_runtime(runtime);

  assert.equal(fixture.controller.get_state().unread_count, 1);
  assert.equal(fixture.controller.get_state().notifications[0]?.kind, "session_turn_completed");
  assert.deepEqual(fixture.badge_counts, [0, 1]);
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
    { notification_id: "broken", kind: "unknown" },
  ];
  const store = new NotificationStore({
    get: () => stored,
    set: (_key: string, value: unknown) => { stored = value; },
    remove: () => undefined,
  } as never);

  assert.deepEqual(store.read().map((notification) => notification.notification_id), ["valid"]);
  store.write([]);
  assert.deepEqual(stored, []);
});

test("Renderer 按 Agent 聚合并按 Session 精确查询未读通知", () => {
  const fixture = create_fixture();
  fixture.controller.publish({ kind: "session_turn_completed", topic_key: "session:writer", target, scopes: agent_scope, title: "已完成", created_at: 1 });
  const state = fixture.controller.get_state();

  assert.equal(has_unread_agent_notification(state, "writer"), true);
  assert.equal(has_unread_chat_notification(state), true);
  assert.equal(has_unread_session_notification(state, "workspace", "writer", "session"), true);
  assert.equal(has_unread_session_notification(state, "workspace", "writer", "other"), false);
  assert.deepEqual(notification_target_from_navigation({ kind: "session", workspace_id: "workspace", agent_id: "writer", session_id: "session" }), target);
  assert.equal(notification_target_from_navigation({ kind: "agent", agent_id: "writer" }), undefined);
});

test("Chat 一级导航只汇总 Session 未读通知", () => {
  const fixture = create_fixture();
  const producer = new PluginNotificationProducer(fixture.controller);
  producer.publish("task", { topic_key: "global", title: "Plugin 完成", route: {} });

  assert.equal(has_unread_chat_notification(fixture.controller.get_state()), false);
  fixture.controller.publish({ kind: "session_turn_completed", topic_key: "session:writer", target, scopes: agent_scope, title: "Session 完成", created_at: 1 });
  assert.equal(has_unread_chat_notification(fixture.controller.get_state()), true);

  fixture.controller.mark_target_read(target);
  assert.equal(has_unread_chat_notification(fixture.controller.get_state()), false);
});

test("Plugin 发布由宿主绑定身份并按本地 topic 聚合", () => {
  const fixture = create_fixture();
  const producer = new PluginNotificationProducer(fixture.controller);
  producer.publish("task", { topic_key: "agent:writer:task:daily", title: "第一次完成", route: { agent_id: "writer", task_title: "daily", view: "run", run_timestamp: "first" } });
  producer.publish("task", { topic_key: "agent:writer:task:daily", title: "第二次完成", route: { agent_id: "writer", task_title: "daily", view: "run", run_timestamp: "second" } });

  const state = fixture.controller.get_state();
  assert.equal(state.unread_count, 1);
  assert.equal(state.notifications[0]?.topic_key, "plugin:task:agent:writer:task:daily");
  assert.equal(has_unread_plugin_notification(state, "task"), true);
  assert.deepEqual(plugin_renderer_notifications(state, "task"), [{
    topic_key: "agent:writer:task:daily",
    title: "第二次完成",
    route: { agent_id: "writer", task_title: "daily", view: "run", run_timestamp: "second" },
    created_at: state.notifications[0]?.created_at,
  }]);
});

test("Plugin 路由只有完全可见时才收口已读", () => {
  const fixture = create_fixture();
  const producer = new PluginNotificationProducer(fixture.controller);
  const unread_route = { agent_id: "writer", task_title: "daily", view: "run", run_timestamp: "run-1" };
  producer.publish("task", { topic_key: "agent:writer:task:daily", title: "已完成", route: unread_route });

  fixture.controller.set_view_state(7, { target: { kind: "plugin", plugin_id: "task", route: { task_title: "daily", agent_id: "writer" } }, visible: true });
  assert.equal(fixture.controller.get_state().unread_count, 1);
  fixture.controller.set_view_state(7, { target: { kind: "plugin", plugin_id: "task", route: { ...unread_route } }, visible: true });
  assert.equal(fixture.controller.get_state().unread_count, 0);
  assert.deepEqual(notification_target_from_navigation(
    { kind: "plugin_workspace", plugin_id: "task" },
    { task: unread_route },
  ), { kind: "plugin", plugin_id: "task", route: unread_route });
});

test("Plugin 可以清除自身命名空间内的一个未读主题", () => {
  const fixture = create_fixture();
  const producer = new PluginNotificationProducer(fixture.controller);
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

test("Agent 生命周期结束会清理 Session 与 Plugin 执行范围通知", () => {
  const fixture = create_fixture();
  const producer = new PluginNotificationProducer(fixture.controller);
  fixture.controller.publish({ kind: "session_turn_completed", topic_key: "session", target, scopes: agent_scope, title: "session", created_at: 1 });
  producer.publish("task", { topic_key: "agent:writer:task:daily", title: "task", route: {} }, "writer");
  producer.publish("task", { topic_key: "global", title: "global", route: {} });

  fixture.controller.mark_scope_read({ kind: "agent", agent_id: "writer" });

  assert.deepEqual(fixture.controller.get_state().notifications.map((notification) => notification.topic_key), ["plugin:task:global"]);
});
