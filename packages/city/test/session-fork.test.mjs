/** @file 验证 Session Fork 锚点包含语义。 */

import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { Agent } from "../../agent/bin/index.js";
import { create_workspace_entry } from "../../agent/bin/internal/index.js";
import { Workspace } from "@downcity/city";
import { MockModelClient } from "../../agent/scripts/ModelClientMock.mjs";

async function create_session(t) {
  const root_path = await fs.mkdtemp(path.join(os.tmpdir(), "downcity-session-fork-"));
  t.after(async () => await fs.rm(root_path, { recursive: true, force: true }));
  const model = new MockModelClient({
    generate: async () => ({ text: "fork reply" }),
  });
  const agent = new Agent({ id: "fork_test_agent", model });
  t.after(async () => await agent.dispose());
  const workspace = new Workspace({ id: "fork_workspace", path: root_path, data_root_path: path.join(root_path, "data") });
  const entry = create_workspace_entry(agent, workspace);
  return {
    entry,
    session: await entry.sessions.create({ session_id: "source" }),
  };
}

test("Fork 默认包含锚点消息，显式排除时只复制锚点之前的历史", async (t) => {
  const { session } = await create_session(t);
  await session.append_user_message({ text: "第一条" });
  await session.append_assistant_message({ text: "第一次回答" });
  await session.append_user_message({ text: "需要编辑" });
  const source_messages = (await session.messages()).items;
  const target = source_messages.find((message) => message.type === "user" && message.parts.some((part) => part.type === "text" && part.text === "需要编辑"));
  assert.ok(target);

  const included = await session.fork({ message_id: target.message_id });
  const excluded = await session.fork({ message_id: target.message_id, include_message: false });
  assert.equal((await included.messages()).items.length, 3);
  assert.equal((await excluded.messages()).items.length, 2);
  assert.deepEqual((await excluded.messages()).items.map((message) => message.type), ["user", "assistant"]);
});

test("Fork Session 由 AgentSessions 接管并持续发布 Turn 终态", async (t) => {
  const { entry, session } = await create_session(t);
  await session.append_user_message({ text: "需要编辑" });
  const target = (await session.messages()).items.find((message) => message.type === "user");
  assert.ok(target);

  const forked = await session.fork({ message_id: target.message_id, include_message: false });
  const restored = await entry.sessions.get(forked.id);
  assert.equal(restored, forked);

  const turn_mutations = [];
  const unsubscribe = restored.subscribe((mutation) => {
    if (mutation.variant === "turn") turn_mutations.push(mutation);
  });
  const turn = await restored.prompt({ query: "编辑后的消息" });
  assert.equal((await turn.finished).success, true);
  unsubscribe();

  assert.equal(turn_mutations.some((mutation) => mutation.type === "start"), true);
  assert.equal(
    turn_mutations.some((mutation) => mutation.type === "finish" && mutation.status === "completed"),
    true,
  );
});
