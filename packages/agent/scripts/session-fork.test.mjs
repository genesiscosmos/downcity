/** @file 验证 Session Fork 锚点包含语义。 */

import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { Agent } from "../bin/index.js";
import { create_agent_workspace } from "../bin/internal/index.js";
import { Workspace } from "@downcity/workspace";

async function create_session(t) {
  const root_path = await fs.mkdtemp(path.join(os.tmpdir(), "downcity-session-fork-"));
  t.after(async () => await fs.rm(root_path, { recursive: true, force: true }));
  const agent = new Agent({ id: "fork_test_agent" });
  t.after(async () => await agent.dispose());
  const workspace = new Workspace({ id: "fork_workspace", path: root_path, data_root_path: path.join(root_path, "data") });
  return await create_agent_workspace(agent, workspace).sessions.create({ session_id: "source" });
}

test("Fork 默认包含锚点消息，显式排除时只复制锚点之前的历史", async (t) => {
  const session = await create_session(t);
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
