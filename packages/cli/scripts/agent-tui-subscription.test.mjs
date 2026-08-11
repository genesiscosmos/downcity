/**
 * Agent Chat TUI Session 订阅、快照合并与切换生命周期测试。
 */

import assert from "node:assert/strict";
import test from "node:test";

import { ChatSessionSubscription } from "../bin/city/agent/tui/controllers/ChatSessionSubscription.js";

function create_deferred() {
  let resolve;
  const promise = new Promise((next_resolve) => {
    resolve = next_resolve;
  });
  return { promise, resolve };
}

function create_session(session_id, messages_promise = Promise.resolve({ items: [] })) {
  let subscriber;
  let unsubscribe_count = 0;
  return {
    session: {
      id: session_id,
      subscribe(next_subscriber) {
        subscriber = next_subscriber;
        return () => {
          unsubscribe_count += 1;
        };
      },
      async get_info() {
        return { session_id: this.id, title: `Title ${this.id}` };
      },
      async messages() {
        return await messages_promise;
      },
      async status() {
        return {
          session_id: this.id,
          state: "idle",
          security: {
            approval_mode: "ask",
            effective_approval_mode: "ask",
          },
        };
      },
      async interactions() {
        return [];
      },
    },
    emit_title(title) {
      subscriber({
        mutation_id: `title-${session_id}-${title}`,
        session_id,
        created_at: 1,
        variant: "session",
        type: "title",
        title,
      });
    },
    get unsubscribe_count() {
      return unsubscribe_count;
    },
  };
}

test("先缓冲 Mutation，再应用快照并持续实时投影", async () => {
  const messages_deferred = create_deferred();
  const target = create_session("session-subscribe", messages_deferred.promise);
  const applied = [];
  const subscription = new ChatSessionSubscription({
    remote_agent: {
      sessions: {
        async get() {
          return target.session;
        },
      },
    },
    on_snapshot(snapshot) {
      applied.push(`snapshot:${snapshot.title}`);
    },
    on_mutation(mutation) {
      applied.push(`mutation:${mutation.title}`);
    },
  });

  const activating = subscription.activate(target.session.id);
  await Promise.resolve();
  await Promise.resolve();
  target.emit_title("Buffered");
  messages_deferred.resolve({ items: [] });
  await activating;
  target.emit_title("Live");

  assert.deepEqual(applied, [
    "snapshot:Title session-subscribe",
    "mutation:Buffered",
    "mutation:Live",
  ]);
  subscription.dispose();
  assert.equal(target.unsubscribe_count, 1);
  assert.equal(subscription.session, null);
});

test("切换 Session 会取消旧订阅并忽略旧快照和后续事件", async () => {
  const old_messages = create_deferred();
  const old_target = create_session("session-old", old_messages.promise);
  const new_target = create_session("session-new");
  const snapshots = [];
  const mutations = [];
  const sessions = new Map([
    [old_target.session.id, old_target.session],
    [new_target.session.id, new_target.session],
  ]);
  const subscription = new ChatSessionSubscription({
    remote_agent: {
      sessions: {
        async get(session_id) {
          return sessions.get(session_id);
        },
      },
    },
    on_snapshot(snapshot) {
      snapshots.push(snapshot.session_id);
    },
    on_mutation(mutation) {
      mutations.push(mutation.session_id);
    },
  });

  const old_activation = subscription.activate(old_target.session.id);
  await Promise.resolve();
  await Promise.resolve();
  old_target.emit_title("Old buffered");
  await subscription.activate(new_target.session.id);
  old_target.emit_title("Old ignored");
  new_target.emit_title("New live");
  old_messages.resolve({ items: [] });
  await old_activation;

  assert.deepEqual(snapshots, ["session-new"]);
  assert.deepEqual(mutations, ["session-new"]);
  assert.equal(old_target.unsubscribe_count, 1);
  assert.equal(subscription.session?.id, "session-new");
});
