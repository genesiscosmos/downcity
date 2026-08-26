import test from "node:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import { Agent, City, Group, Session } from "../bin/index.js";
import { LocalStorageProvider, Workspace } from "@downcity/workspace";

class RecordingSession extends Session {
  static created = [];

  async prompt(input) {
    RecordingSession.created.push({ agent_id: this.agent_id, query: input.query });
    return {
      id: `turn-${this.id}`,
      result: null,
      finished: Promise.resolve({ turn_id: `turn-${this.id}`, text: `reply:${this.agent_id}`, success: true }),
    };
  }
}

test("Group broadcasts user messages and collects member replies", async () => {
  RecordingSession.created = [];
  const city = new City();
  const architect = new Agent({ id: "architect", session_class: RecordingSession });
  const reviewer = new Agent({ id: "reviewer", session_class: RecordingSession });
  city.agents.add(architect);
  city.agents.add(reviewer);
  const group = new Group({ id: "delivery", members: [{ agent: architect }, { agent: reviewer }] });
  city.groups.add(group);
  const group_session = await group.sessions.create();
  await group_session.prompt({ query: "analyze payment" });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(RecordingSession.created.map((entry) => entry.agent_id), ["architect", "reviewer"]);
  assert.deepEqual((await group_session.messages()).map((message) => [message.sender_type, message.sender_id, message.text]), [
    ["user", "user", "analyze payment"],
    ["agent", "architect", "reply:architect"],
    ["agent", "reviewer", "reply:reviewer"],
  ]);
  const architect_sessions = await architect.sessions.list();
  assert.equal(architect_sessions.items.length, 1);
  assert.deepEqual(architect_sessions.items[0].origin, { type: "group", group_id: "delivery", group_session_id: group_session.id });
  await city.close();
});

test("Group 本身不绑定 Workspace，GroupSession 才绑定 Workspace", async () => {
  const city = new City({ workspaces: [new Workspace({ id: "project", path: process.cwd() })] });
  const agent = new Agent({ id: "builder", session_class: RecordingSession });
  city.agents.add(agent);
  const group = new Group({ id: "valid", members: [{ agent }] });
  city.groups.add(group);
  const group_session = await group.sessions.create({ workspace: city.workspaces.get("project") });
  assert.equal(group_session.workspace_id, "project");
  await city.close();
});

test("Group 成员 Session 使用 Group 的共享 Workspace", async () => {
  RecordingSession.created = [];
  const workspace = new Workspace({ id: "shared-project", path: process.cwd() });
  const city = new City({ workspaces: [workspace] });
  const agent = new Agent({ id: "builder", session_class: RecordingSession });
  city.agents.add(agent);
  const group = new Group({ id: "build-team", members: [{ agent }] });
  city.groups.add(group);
  const group_session = await group.sessions.create({ workspace });
  await group_session.prompt({ query: "build" });
  await new Promise((resolve) => setTimeout(resolve, 0));
  const sessions = await agent.sessions.list({ workspace_id: "shared-project" });
  assert.equal(sessions.items.length, 1);
  assert.deepEqual(sessions.items[0].origin, { type: "group", group_id: "build-team", group_session_id: group_session.id });
  assert.equal((await group.sessions.list({ workspace_id: "shared-project" })).length, 1);
  assert.equal((await group.sessions.get(group_session.id, { workspace })).workspace_id, "shared-project");
  await city.close();
});

test("GroupSession 使用 City Storage 持久化并可恢复", async () => {
  RecordingSession.created = [];
  const root_path = await fs.mkdtemp(path.join(os.tmpdir(), "downcity-group-session-"));
  const storage = new LocalStorageProvider(root_path);
  const city = new City({ storage });
  const agent = new Agent({ id: "builder", session_class: RecordingSession });
  city.agents.add(agent);
  const group = new Group({ id: "persistent-team", members: [{ agent }] });
  city.groups.add(group);
  const created = await group.sessions.create();
  await created.prompt({ query: "persist this message" });
  await new Promise((resolve) => setTimeout(resolve, 50));
  await city.close();

  const restored_city = new City({ storage });
  const restored_agent = new Agent({ id: "builder", session_class: RecordingSession });
  restored_city.agents.add(restored_agent);
  const restored_group = new Group({ id: "persistent-team", members: [{ agent: restored_agent }] });
  restored_city.groups.add(restored_group);
  const restored = await restored_group.sessions.get(created.id);
  assert.ok(restored);
  assert.deepEqual((await restored.messages()).map((message) => message.text), [
    "persist this message",
    "reply:builder",
  ]);
  const summaries = await restored_group.sessions.list();
  assert.equal(summaries.length, 1);
  assert.equal(summaries[0].id, created.id);
  assert.equal(summaries[0].message_count, 2);
  RecordingSession.created = [];
  await restored.prompt({ query: "reuse member session" });
  assert.deepEqual(RecordingSession.created.map((entry) => entry.agent_id), ["builder"]);
  await restored_city.close();
  await fs.rm(root_path, { recursive: true, force: true });
});

test("GroupSession 恢复时修复尾部损坏的消息记录", async () => {
  const root_path = await fs.mkdtemp(path.join(os.tmpdir(), "downcity-group-tail-"));
  const storage = new LocalStorageProvider(root_path);
  const city = new City({ storage });
  const agent = new Agent({ id: "tail-agent", session_class: RecordingSession });
  city.agents.add(agent);
  const group = new Group({ id: "tail-group", members: [{ agent }] });
  city.groups.add(group);
  const session = await group.sessions.create();
  await session.prompt({ query: "keep this" });
  await city.close();
  const messages_path = path.join(root_path, "groups", "tail-group", "sessions", encodeURIComponent(session.id), "messages.jsonl");
  await fs.appendFile(messages_path, "{\"id\":\"incomplete");

  const restored_city = new City({ storage: new LocalStorageProvider(root_path) });
  const restored_agent = new Agent({ id: "tail-agent", session_class: RecordingSession });
  restored_city.agents.add(restored_agent);
  const restored_group = new Group({ id: "tail-group", members: [{ agent: restored_agent }] });
  restored_city.groups.add(restored_group);
  const restored = await restored_group.sessions.get(session.id);
  assert.deepEqual((await restored.messages()).map((message) => message.text), ["keep this", "reply:tail-agent"]);
  await restored_city.close();
  await fs.rm(root_path, { recursive: true, force: true });
});

test("GroupSession prompt 按提交顺序串行传播", async () => {
  const calls = [];
  class OrderedSession extends Session {
    async prompt(input) {
      calls.push(input.query);
      await new Promise((resolve) => setTimeout(resolve, 10));
      return {
        id: `turn-${this.id}`,
        result: null,
        finished: Promise.resolve({ turn_id: `turn-${this.id}`, text: `reply:${input.query}`, success: true }),
      };
    }
  }
  const city = new City();
  const agent = new Agent({ id: "ordered", session_class: OrderedSession });
  city.agents.add(agent);
  const group = new Group({ id: "ordered-group", members: [{ agent }] });
  city.groups.add(group);
  const session = await group.sessions.create();
  await Promise.all([session.prompt({ query: "first" }), session.prompt({ query: "second" })]);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].includes("Current message from user: first"), true);
  assert.equal(calls[1].includes("Current message from user: second"), true);
  assert.deepEqual((await session.messages()).filter((message) => message.sender_type === "user").map((message) => message.text), ["first", "second"]);
  await city.close();
});

test("GroupSession stop 会丢弃尚未开始的 prompt", async () => {
  const finished = [];
  class StoppableSession extends Session {
    async prompt(input) {
      finished.push(input.query);
      return {
        id: `turn-${this.id}`,
        result: null,
        finished: new Promise((resolve) => {
          this.resolve_finished = resolve;
        }),
      };
    }

    async stop() {
      this.resolve_finished?.({ turn_id: `turn-${this.id}`, text: "", success: false });
      this.resolve_finished = undefined;
      return { stopped: true };
    }
  }
  const city = new City();
  const agent = new Agent({ id: "stoppable", session_class: StoppableSession });
  city.agents.add(agent);
  const group = new Group({ id: "stoppable-group", members: [{ agent }] });
  city.groups.add(group);
  const session = await group.sessions.create();
  const first = session.prompt({ query: "first" });
  await new Promise((resolve) => setTimeout(resolve, 0));
  const second = session.prompt({ query: "second" });
  await session.stop();
  await Promise.all([first, second]);
  assert.deepEqual(finished.map((query) => query.includes("Current message from user: first")), [true]);
  assert.deepEqual((await session.messages()).filter((message) => message.sender_type === "user").map((message) => message.text), ["first"]);
  await city.close();
});
