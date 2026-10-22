/** @file 验证 Session Fork 锚点包含语义。 */

import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { Agent } from "../../agent/bin/index.js";
import { City, LocalStorageProvider, Workspace } from "@downcity/city";
import { MockModelClient } from "../../agent/scripts/ModelClientMock.mjs";

async function create_session(t) {
  const root_path = await fs.mkdtemp(path.join(os.tmpdir(), "downcity-session-fork-"));
  t.after(async () => await fs.rm(root_path, { recursive: true, force: true }));
  const model = new MockModelClient({
    generate: async () => ({ text: "fork reply" }),
  });
  const agent = new Agent({ id: "fork_test_agent", model });
  const workspace = new Workspace({ id: "fork_workspace", path: root_path, data_root_path: path.join(root_path, "data") });
  const city = new City({
    storage: new LocalStorageProvider(path.join(root_path, "city-data")),
    agents: [agent],
    workspaces: [workspace],
  });
  t.after(async () => await city.close());
  return {
    root_path,
    agent,
    workspace,
    session: await agent.sessions.create({ session_id: "source", workspace }),
  };
}

test("Fork 默认包含锚点消息，显式排除时只复制锚点之前的历史", async (t) => {
  const { session } = await create_session(t);
  await session.append_user_message({ text: "第一条" });
  await session.append_agent_message({ text: "第一次回答" });
  await session.append_user_message({ text: "需要编辑" });
  const source_messages = (await session.messages()).items;
  const target = source_messages.find((message) => message.role === "user" && message.parts.some((part) => part.type === "text" && part.text === "需要编辑"));
  assert.ok(target);

  const included = await session.fork({ message_id: target.message_id });
  const excluded = await session.fork({ message_id: target.message_id, include_message: false });
  const included_items = (await included.messages()).items;
  const excluded_items = (await excluded.messages()).items;
  // 每个新 Session 在自己的时间线末尾多出一条记录本次分叉的 Action，复制出的历史顺序不变。
  assert.deepEqual(included_items.map((message) => message.role), ["user", "agent", "user", "agent"]);
  assert.deepEqual(excluded_items.map((message) => message.role), ["user", "agent", "agent"]);
  assert.equal(included_items.at(-1).parts[0].type, "action");
  assert.equal(included_items.at(-1).parts[0].action_type, "history-fork");
  assert.equal(excluded_items.at(-1).parts[0].action_type, "history-fork");
  // 源 Session 不被分叉污染。
  assert.deepEqual((await session.messages()).items.map((message) => message.role), ["user", "agent", "user"]);
});

test("Fork Session 由 AgentSessions 接管并持续发布 Turn 终态", async (t) => {
  const { agent, workspace, session } = await create_session(t);
  await session.append_user_message({ text: "需要编辑" });
  const target = (await session.messages()).items.find((message) => message.role === "user");
  assert.ok(target);

  const forked = await session.fork({ message_id: target.message_id, include_message: false });
  const restored = await agent.sessions.get(forked.id, "work", { workspace });
  assert.equal(restored, forked);

  const turn_mutations = [];
  const unsubscribe = restored.subscribe((mutation) => {
    if (mutation.variant === "turn") turn_mutations.push(mutation);
  });
  const turn = await restored.prompt({ actor: { kind: "user", user_id: "local" }, query: "编辑后的消息" });
  assert.equal((await turn.finished).success, true);
  unsubscribe();

  assert.equal(turn_mutations.some((mutation) => mutation.type === "start"), true);
  assert.equal(
    turn_mutations.some((mutation) => mutation.type === "finish" && mutation.status === "completed"),
    true,
  );
});

test("Fork 复制已终结的 Turn 后不残留占用，读路径始终可用", async (t) => {
  const { session } = await create_session(t);
  // 只有真实 Turn 产生的 user message 才带发起方。fork 会为它重新分配 turn_id，
  // 而完成日志属于源 Session，因此不能凭「查不到终态」判定本会话还有未完成的执行。
  const turn = await session.prompt({ actor: { kind: "user", user_id: "local" }, query: "第一轮" });
  await turn.finished;
  const anchor = (await session.messages()).items.find((message) => message.role === "user");
  assert.ok(anchor);

  const forked = await session.fork({ message_id: anchor.message_id });
  const forked_status = await forked.status();
  assert.equal(forked_status.state, "idle");
  assert.equal(forked_status.occupied_by, null);

  // 公开 API 追加的消息没有发起方；读路径必须保持可用，不能用解析异常把它停掉。
  await session.append_user_message({ text: "外部追加" });
  assert.equal((await session.status()).state, "idle");
});

test("Fork 将源 Session 持有的附件复制到自己的生命周期", async (t) => {
  const { root_path, agent, workspace, session } = await create_session(t);
  const workspace_file = path.join(root_path, "workspace.txt");
  await fs.writeFile(workspace_file, "workspace");
  const turn = await session.prompt({
    actor: { kind: "user", user_id: "local" },
    query: [{
      type: "file",
      media_type: "text/plain",
      url: "data:text/plain;base64,aGVsbG8=",
      filename: "hello.txt",
    }, {
      type: "file",
      media_type: "text/plain",
      url: workspace_file,
      filename: "workspace.txt",
    }],
  });
  await turn.finished;
  const source_message = (await session.messages()).items.find((message) => message.role === "user");
  const source_file = source_message?.role === "user" ? source_message.parts.find((part) => part.type === "file") : undefined;
  assert.ok(source_file);

  const forked = await session.fork();
  const forked_message = (await forked.messages()).items.find((message) => message.role === "user");
  const forked_file = forked_message?.role === "user" ? forked_message.parts.find((part) => part.type === "file") : undefined;
  assert.ok(forked_file);
  assert.notEqual(forked_file.url, source_file.url);
  assert.equal(await fs.readFile(forked_file.url, "utf8"), "hello");
  const forked_workspace_file = forked_message?.role === "user" ? forked_message.parts.find((part) => part.type === "file" && part.filename === "workspace.txt") : undefined;
  assert.equal(forked_workspace_file?.url, workspace_file);

  await agent.sessions.get(session.id, "work", { workspace });
  await agent.sessions.archive({ id: session.id });
  assert.equal(await fs.readFile(forked_file.url, "utf8"), "hello");
});
