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

test("City 只允许 Group 使用已登记的 Workspace", async () => {
  const city = new City({ workspaces: [new Workspace({ id: "project", path: process.cwd() })] });
  const agent = new Agent({ id: "builder", session_class: RecordingSession });
  city.agents.add(agent);
  const external_workspace = new Workspace({ id: "external", path: process.cwd() });
  assert.throws(() => city.groups.add(new Group({ id: "invalid", members: [{ agent }], workspace: external_workspace })), /not registered/u);
  const group = new Group({ id: "valid", members: [{ agent }], workspace: city.workspaces.get("project") });
  city.groups.add(group);
  assert.equal(group.workspace?.id, "project");
  await external_workspace.dispose();
  await city.close();
});

test("Group 成员 Session 使用 Group 的共享 Workspace", async () => {
  RecordingSession.created = [];
  const workspace = new Workspace({ id: "shared-project", path: process.cwd() });
  const city = new City({ workspaces: [workspace] });
  const agent = new Agent({ id: "builder", session_class: RecordingSession });
  city.agents.add(agent);
  const group = new Group({ id: "build-team", members: [{ agent }], workspace });
  city.groups.add(group);
  const group_session = await group.sessions.create();
  await group_session.prompt({ query: "build" });
  await new Promise((resolve) => setTimeout(resolve, 0));
  const sessions = await agent.sessions.list({ workspace_id: "shared-project" });
  assert.equal(sessions.items.length, 1);
  assert.deepEqual(sessions.items[0].origin, { type: "group", group_id: "build-team", group_session_id: group_session.id });
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
  assert.equal((await restored_group.sessions.list()).length, 1);
  await restored_city.close();
  await fs.rm(root_path, { recursive: true, force: true });
});
