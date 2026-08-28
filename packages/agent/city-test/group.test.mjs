import test from "node:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import { Agent, City, Group, Session } from "../bin/index.js";
import { LocalStorageProvider, Workspace } from "@downcity/workspace";
import { MockLanguageModelV3 } from "ai/test";

async function wait_for_group_idle(group_session, timeout_ms = 1000) {
  await new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      unsubscribe();
      clearTimeout(timer);
      resolve();
    };
    const unsubscribe = group_session.subscribe((event) => {
      if (event.type === "status" && ["idle", "failed", "stopped"].includes(event.phase) && event.members.every((member) => !member.running)) finish();
    });
    const timer = setTimeout(finish, timeout_ms);
  });
  return await group_session.messages();
}

// 测试专用策略：生产代码不再提供隐式规则调度，行为测试显式注入最小策略。
const test_dispatch_strategy = {
  decide_dispatch({ trigger, message, members }) {
    if (trigger === "auto") return { nodes: [], terminal: true };
    const collective = /你们|大家|各自|分别|同时|一起|所有人/.test(message.text);
    return {
      nodes: [{
        node_id: `test-${message.id}`,
        member_ids: collective ? members.map((member) => member.id) : [members[0].id],
        response_mode: collective ? "parallel" : "single",
        depends_on_node_ids: [],
        instruction: "测试策略：只代表自己发言。",
      }],
      terminal: true,
    };
  },
};

function create_dispatch_tool_call(input, tool_call_id = "dispatch-call") {
  return {
    type: "tool-call",
    toolCallId: tool_call_id,
    toolName: "dispatch_group",
    input: JSON.stringify(input),
  };
}

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
  const group = new Group({ id: "delivery", members: [architect, reviewer], dispatch_strategy: test_dispatch_strategy });
  city.groups.add(group);
  const group_session = await group.sessions.create();
  const prompt_result = await group_session.prompt({ query: "大家分别 analyze payment" });
  assert.equal(prompt_result.success, true);
  assert.match(prompt_result.turn_id, /^group-turn-/);
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(RecordingSession.created.map((entry) => entry.agent_id), ["architect", "reviewer"]);
  assert.deepEqual((await group_session.messages()).map((message) => [message.sender_type, message.sender_id, message.text]), [
    ["user", "user", "大家分别 analyze payment"],
    ["agent", "architect", "reply:architect"],
    ["agent", "reviewer", "reply:reviewer"],
  ]);
  const architect_sessions = await architect.sessions.list();
  assert.equal(architect_sessions.items.length, 1);
  assert.deepEqual(architect_sessions.items[0].origin, { type: "group", group_id: "delivery", group_session_id: group_session.id });
  await city.close();
});

test("Group.model uses AI dispatch to select only the returned members", async () => {
  RecordingSession.created = [];
  let dispatch_calls = 0;
  const dispatch_model = new MockLanguageModelV3({
    modelId: "group-dispatch-model",
    doGenerate: async () => ({
      content: [create_dispatch_tool_call(dispatch_calls++ === 0
        ? { steps: [["reviewer"]], next: "continue" }
        : { steps: [], next: "stop" })],
      finishReason: { unified: "stop", raw: "stop" },
      usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
      warnings: [],
    }),
  });
  const city = new City();
  const architect = new Agent({ id: "architect", session_class: RecordingSession });
  const reviewer = new Agent({ id: "reviewer", session_class: RecordingSession });
  city.agents.add(architect);
  city.agents.add(reviewer);
  const group = new Group({ id: "ai-delivery", model: dispatch_model, members: [architect, reviewer] });
  city.groups.add(group);
  const group_session = await group.sessions.create();
  await group_session.prompt({ query: "请审查这个变更" });
  await wait_for_group_idle(group_session);
  assert.deepEqual(RecordingSession.created.map((entry) => entry.agent_id), ["reviewer"]);
  await city.close();
});

test("AI Dispatch 返回空响应图时直接结束当前调度", async () => {
  RecordingSession.created = [];
  const dispatch_model = new MockLanguageModelV3({
    modelId: "empty-dispatch-model",
    doGenerate: async () => ({
      content: [create_dispatch_tool_call({ steps: [], next: "stop" })],
      finishReason: { unified: "stop", raw: "stop" },
      usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
      warnings: [],
    }),
  });
  const city = new City();
  const architect = new Agent({ id: "architect", session_class: RecordingSession });
  const reviewer = new Agent({ id: "reviewer", session_class: RecordingSession });
  city.agents.add(architect);
  city.agents.add(reviewer);
  const group = new Group({ id: "empty-dispatch", model: dispatch_model, members: [architect, reviewer] });
  city.groups.add(group);
  const empty_session = await group.sessions.create();
  await empty_session.prompt({ query: "请讨论这个问题" });
  await wait_for_group_idle(empty_session);
  assert.deepEqual(RecordingSession.created.map((entry) => entry.agent_id), []);
  assert.deepEqual((await empty_session.messages()).map((message) => message.text), ["请讨论这个问题"]);
  await city.close();
});

test("Group 没有 model 且未注入策略时记录调度失败", async () => {
  const city = new City();
  const agent = new Agent({ id: "model-required-agent", session_class: RecordingSession });
  city.agents.add(agent);
  const group = new Group({ id: "model-required-group", members: [agent] });
  city.groups.add(group);
  const group_session = await group.sessions.create();

  await group_session.prompt({ query: "请回答" });
  await wait_for_group_idle(group_session);

  assert.deepEqual((await group_session.messages()).map((message) => message.text), [
    "请回答",
    "Group requires a configured model for dispatch",
  ]);
  await city.close();
});

test("AI Dispatch 失败时不切换到隐式规则策略", async () => {
  const dispatch_model = new MockLanguageModelV3({
    modelId: "failing-dispatch-model",
    doGenerate: async () => { throw new Error("dispatch unavailable"); },
  });
  const city = new City();
  const agent = new Agent({ id: "failing-dispatch-agent", session_class: RecordingSession });
  city.agents.add(agent);
  const group = new Group({ id: "failing-dispatch-group", model: dispatch_model, members: [agent] });
  city.groups.add(group);
  const group_session = await group.sessions.create();

  await group_session.prompt({ query: "请回答" });
  await wait_for_group_idle(group_session);

  assert.deepEqual(RecordingSession.created.map((entry) => entry.agent_id), []);
  assert.match((await group_session.messages()).at(-1).text, /^Group dispatch model failed:/);
  await city.close();
});

test("AI Dispatch 未调用 dispatch_group 时记录协议错误", async () => {
  const dispatch_model = new MockLanguageModelV3({
    modelId: "text-only-dispatch-model",
    doGenerate: async () => ({
      content: [{ type: "text", text: "我建议让 reviewer 回复。" }],
      finishReason: { unified: "stop", raw: "stop" },
      usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
      warnings: [],
    }),
  });
  const city = new City();
  const agent = new Agent({ id: "text-only-agent", session_class: RecordingSession });
  city.agents.add(agent);
  const group = new Group({ id: "text-only-group", model: dispatch_model, members: [agent] });
  city.groups.add(group);
  const group_session = await group.sessions.create();

  await group_session.prompt({ query: "请回答" });
  await wait_for_group_idle(group_session);

  assert.deepEqual(RecordingSession.created.map((entry) => entry.agent_id), []);
  assert.match((await group_session.messages()).at(-1).text, /did not call dispatch_group/);
  await city.close();
});

test("AI Dispatch 拒绝未知成员和重复投递", async () => {
  const inputs = [
    { steps: [["unknown"]], next: "stop" },
    { steps: [["known"], ["known"]], next: "stop" },
  ];
  for (const [index, input] of inputs.entries()) {
    const dispatch_model = new MockLanguageModelV3({
      modelId: `invalid-dispatch-model-${index}`,
      doGenerate: async () => ({
        content: [create_dispatch_tool_call(input)],
        finishReason: { unified: "tool-calls", raw: "tool_calls" },
        usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
        warnings: [],
      }),
    });
    const city = new City();
    const agent = new Agent({ id: "known", session_class: RecordingSession });
    city.agents.add(agent);
    const group = new Group({ id: `invalid-dispatch-group-${index}`, model: dispatch_model, members: [agent] });
    city.groups.add(group);
    const group_session = await group.sessions.create();

    await group_session.prompt({ query: "请回答" });
    await wait_for_group_idle(group_session);

    assert.match((await group_session.messages()).at(-1).text, /Group dispatch model failed:/);
    await city.close();
  }
});

test("GroupSession publishes messages and member runtime through one event stream", async () => {
  const events = [];
  const city = new City();
  const agent = new Agent({ id: "status-agent", session_class: RecordingSession });
  city.agents.add(agent);
  const group = new Group({ id: "status-group", members: [agent], dispatch_strategy: test_dispatch_strategy });
  city.groups.add(group);
  const group_session = await group.sessions.create();
  const unsubscribe = group_session.subscribe((event) => events.push(event));
  await group_session.prompt({ query: "status" });
  await wait_for_group_idle(group_session);
  unsubscribe();
  const status_events = events.filter((event) => event.type === "status");
  assert.equal(status_events[0].phase, "dispatching");
  assert.equal(typeof status_events[0].message_id, "string");
  const dispatch_event = status_events.find((event) => event.dispatched_member_ids);
  assert.equal(dispatch_event.phase, "dispatched");
  assert.deepEqual(dispatch_event.dispatched_member_ids, ["status-agent"]);
  assert.equal(dispatch_event.message_id, status_events[0].message_id);
  const dispatch_index = status_events.indexOf(dispatch_event);
  const executing_index = status_events.findIndex((event, index) => index > dispatch_index && event.phase === "executing" && event.members[0].running);
  assert.equal(executing_index > dispatch_index, true);
  assert.equal(status_events.slice(0, dispatch_index).some((event) => event.members[0].running), false);
  assert.equal(status_events.at(-1).phase, "idle");
  assert.equal(status_events.at(-1).members[0].running, false);
  await city.close();
});

test("Group 成员执行失败时把失败事实写入共享消息", async () => {
  class FailingSession extends Session {
    async prompt() {
      return {
        id: `turn-${this.id}`,
        result: null,
        finished: Promise.resolve({
          turn_id: `turn-${this.id}`,
          text: "",
          success: false,
          error: "模型请求被拒绝",
        }),
      };
    }
  }
  const city = new City();
  const agent = new Agent({ id: "failing-agent", session_class: FailingSession });
  city.agents.add(agent);
  const group = new Group({ id: "failure-group", members: [agent], dispatch_strategy: test_dispatch_strategy });
  city.groups.add(group);
  const group_session = await group.sessions.create();

  await group_session.prompt({ query: "请回答" });
  await wait_for_group_idle(group_session);

  assert.deepEqual((await group_session.messages()).map((message) => [message.sender_type, message.text]), [
    ["user", "请回答"],
    ["system", "failing-agent 执行失败：模型请求被拒绝"],
  ]);
  await city.close();
});

test("Group 普通消息只投递一个成员", async () => {
  class RejectingSession extends Session {
    async prompt() {
      throw new Error("成员 Session 不可用");
    }
  }
  RecordingSession.created = [];
  const city = new City();
  const failing_agent = new Agent({ id: "failing-agent", session_class: RejectingSession });
  const healthy_agent = new Agent({ id: "healthy-agent", session_class: RecordingSession });
  city.agents.add(failing_agent);
  city.agents.add(healthy_agent);
  const group = new Group({ id: "partial-failure-group", members: [failing_agent, healthy_agent], dispatch_strategy: test_dispatch_strategy });
  city.groups.add(group);
  const group_session = await group.sessions.create();

  const result = await group_session.prompt({ query: "请共同回答" });
  await wait_for_group_idle(group_session);

  assert.equal(result.success, true);
  assert.deepEqual(RecordingSession.created.map((entry) => entry.agent_id), []);
  assert.deepEqual((await group_session.messages()).map((message) => [message.sender_type, message.text]), [
    ["user", "请共同回答"],
    ["system", "failing-agent 执行失败：成员 Session 不可用"],
  ]);
  await city.close();
});

test("Group 本身不绑定 Workspace，GroupSession 才绑定 Workspace", async () => {
  const city = new City({ workspaces: [new Workspace({ id: "project", path: process.cwd() })] });
  const agent = new Agent({ id: "builder", session_class: RecordingSession });
  city.agents.add(agent);
  const group = new Group({ id: "valid", members: [agent], dispatch_strategy: test_dispatch_strategy });
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
  const group = new Group({ id: "build-team", members: [agent], dispatch_strategy: test_dispatch_strategy });
  city.groups.add(group);
  const group_session = await group.sessions.create({ workspace });
  await group_session.prompt({ query: "build" });
  await wait_for_group_idle(group_session);
  await new Promise((resolve) => setTimeout(resolve, 0));
  const sessions = await agent.sessions.list({ workspace_id: "shared-project" });
  assert.equal(sessions.items.length, 1);
  assert.deepEqual(sessions.items[0].origin, { type: "group", group_id: "build-team", group_session_id: group_session.id });
  assert.equal((await group.sessions.list({ workspace_id: "shared-project" })).length, 1);
  assert.equal((await group.sessions.get(group_session.id, { workspace })).workspace_id, "shared-project");
  await city.close();
});

test("Group 从 City 释放后可以在同一 City 重新装配", async () => {
  const group = new Group({ id: "reattachable-group", members: [new Agent({ id: "reattachable-agent", session_class: RecordingSession })], dispatch_strategy: test_dispatch_strategy });
  const first_city = new City();
  first_city.agents.add(group.members[0]);
  first_city.groups.add(group);
  await first_city.groups.remove(group.id);

  first_city.groups.add(group);
  await group.sessions.create();
  await first_city.close();
});

test("GroupSession 使用 City Storage 持久化并可恢复", async () => {
  RecordingSession.created = [];
  const root_path = await fs.mkdtemp(path.join(os.tmpdir(), "downcity-group-session-"));
  const storage = new LocalStorageProvider(root_path);
  const city = new City({ storage });
  const agent = new Agent({ id: "builder", session_class: RecordingSession });
  city.agents.add(agent);
  const group = new Group({ id: "persistent-team", members: [agent], dispatch_strategy: test_dispatch_strategy });
  city.groups.add(group);
  const created = await group.sessions.create();
  await created.prompt({ query: "persist this message" });
  await wait_for_group_idle(created);
  await city.close();

  const restored_city = new City({ storage });
  const restored_agent = new Agent({ id: "builder", session_class: RecordingSession });
  restored_city.agents.add(restored_agent);
  const restored_group = new Group({ id: "persistent-team", members: [restored_agent], dispatch_strategy: test_dispatch_strategy });
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
  await wait_for_group_idle(restored);
  assert.deepEqual(RecordingSession.created.map((entry) => entry.agent_id), ["builder"]);
  await restored_city.close();
  await fs.rm(root_path, { recursive: true, force: true });
});

test("GroupSession 持久化调度检查点并在收口后清理", async () => {
  const root_path = await fs.mkdtemp(path.join(os.tmpdir(), "downcity-group-checkpoint-"));
  const storage = new LocalStorageProvider(root_path);
  let resolve_finished;
  class BlockingSession extends Session {
    async prompt() {
      return {
        id: `turn-${this.id}`,
        result: null,
        finished: new Promise((resolve) => { resolve_finished = resolve; }),
      };
    }
  }
  const city = new City({ storage });
  const agent = new Agent({ id: "checkpoint-agent", session_class: BlockingSession });
  city.agents.add(agent);
  const group = new Group({ id: "checkpoint-group", members: [agent], dispatch_strategy: test_dispatch_strategy });
  city.groups.add(group);
  const session = await group.sessions.create();
  await session.prompt({ query: "checkpoint" });
  for (let attempt = 0; attempt < 200 && typeof resolve_finished !== "function"; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.equal(typeof resolve_finished, "function");
  const meta_path = path.join(root_path, "groups", "checkpoint-group", "sessions", encodeURIComponent(session.id), "meta.json");
  const pending_meta = JSON.parse(await fs.readFile(meta_path, "utf8"));
  assert.equal(pending_meta.pending_turns.length, 1);
  resolve_finished({ turn_id: "finished", text: "done", success: true });
  await wait_for_group_idle(session);
  const completed_meta = JSON.parse(await fs.readFile(meta_path, "utf8"));
  assert.deepEqual(completed_meta.pending_turns, []);
  assert.deepEqual(completed_meta.auto_frontier_message_ids, []);
  await city.close();
  await fs.rm(root_path, { recursive: true, force: true });
});

test("GroupSession 恢复时修复尾部损坏的消息记录", async () => {
  const root_path = await fs.mkdtemp(path.join(os.tmpdir(), "downcity-group-tail-"));
  const storage = new LocalStorageProvider(root_path);
  const city = new City({ storage });
  const agent = new Agent({ id: "tail-agent", session_class: RecordingSession });
  city.agents.add(agent);
  const group = new Group({ id: "tail-group", members: [agent], dispatch_strategy: test_dispatch_strategy });
  city.groups.add(group);
  const session = await group.sessions.create();
  await session.prompt({ query: "keep this" });
  await wait_for_group_idle(session);
  await city.close();
  const messages_path = path.join(root_path, "groups", "tail-group", "sessions", encodeURIComponent(session.id), "messages.jsonl");
  await fs.appendFile(messages_path, "{\"id\":\"incomplete");

  const restored_city = new City({ storage: new LocalStorageProvider(root_path) });
  const restored_agent = new Agent({ id: "tail-agent", session_class: RecordingSession });
  restored_city.agents.add(restored_agent);
  const restored_group = new Group({ id: "tail-group", members: [restored_agent], dispatch_strategy: test_dispatch_strategy });
  restored_city.groups.add(restored_group);
  const restored = await restored_group.sessions.get(session.id);
  assert.deepEqual((await restored.messages()).map((message) => message.text), ["keep this", "reply:tail-agent"]);
  await restored_city.close();
  await fs.rm(root_path, { recursive: true, force: true });
});

test("GroupSession prompt 立即返回并由 AgentSession 自己排队", async () => {
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
  const group = new Group({ id: "ordered-group", members: [agent], dispatch_strategy: test_dispatch_strategy });
  city.groups.add(group);
  const session = await group.sessions.create();
  const first = await session.prompt({ query: "first" });
  const second = await session.prompt({ query: "second" });
  assert.notEqual(first.turn_id, second.turn_id);
  await wait_for_group_idle(session);
  assert.equal(calls.length, 2);
  assert.equal(calls.some((query) => query.includes("Current message from user: first")), true);
  assert.equal(calls.some((query) => query.includes("Current message from user: second")), true);
  assert.deepEqual((await session.messages()).filter((message) => message.sender_type === "user").map((message) => message.text), ["first", "second"]);
  await city.close();
});

test("Dispatch 响应图按依赖传递上一个成员的回复", async () => {
  RecordingSession.created = [];
  const city = new City();
  const architect = new Agent({ id: "architect", session_class: RecordingSession });
  const reviewer = new Agent({ id: "reviewer", session_class: RecordingSession });
  city.agents.add(architect);
  city.agents.add(reviewer);
  const group = new Group({
    id: "dependency-group",
    members: [architect, reviewer],
    dispatch_strategy: {
      decide_dispatch: ({ trigger }) => trigger === "user"
        ? {
          nodes: [
            { node_id: "architect", member_ids: ["architect"], response_mode: "single", depends_on_node_ids: [], instruction: "先分析。" },
            { node_id: "reviewer", member_ids: ["reviewer"], response_mode: "single", depends_on_node_ids: ["architect"], instruction: "基于前一个成员的回复审查。" },
          ],
          terminal: true,
        }
        : { nodes: [], terminal: true },
    },
  });
  city.groups.add(group);
  const group_session = await group.sessions.create();
  await group_session.prompt({ query: "请分析并审查" });
  await wait_for_group_idle(group_session);
  assert.equal(RecordingSession.created.length, 2);
  assert.equal(RecordingSession.created[0].agent_id, "architect");
  assert.equal(RecordingSession.created[1].agent_id, "reviewer");
  assert.match(RecordingSession.created[1].query, /architect: reply:architect/);
  await city.close();
});

test("唯一 auto dispatch 等待并合并并发输入批次", async () => {
  const calls = [];
  const auto_batches = [];
  class DelayedSession extends Session {
    async prompt(input) {
      calls.push(input.query);
      const query = input.query.includes("first") ? "first" : "second";
      const delay_ms = query === "first" ? 5 : 25;
      return {
        id: `turn-${this.id}-${query}`,
        result: null,
        finished: new Promise((resolve) => setTimeout(() => resolve({
          turn_id: `turn-${this.id}-${query}`,
          text: `reply:${query}`,
          success: true,
        }), delay_ms)),
      };
    }
  }
  const city = new City();
  const agent = new Agent({ id: "batch-agent", session_class: DelayedSession });
  city.agents.add(agent);
  const group = new Group({
    id: "batch-group",
    members: [agent],
    dispatch_strategy: {
      decide_dispatch: ({ trigger, pending_messages }) => {
        if (trigger === "auto") {
          auto_batches.push(pending_messages.map((message) => message.text));
          return { nodes: [], terminal: true };
        }
        return {
          nodes: [{
            node_id: `user-${pending_messages[0]?.id || "message"}`,
            member_ids: ["batch-agent"],
            response_mode: "single",
            depends_on_node_ids: [],
            instruction: "回复当前消息。",
          }],
          terminal: false,
        };
      },
    },
  });
  city.groups.add(group);
  const group_session = await group.sessions.create();
  await Promise.all([
    group_session.prompt({ query: "first" }),
    group_session.prompt({ query: "second" }),
  ]);
  await wait_for_group_idle(group_session, 1500);
  assert.equal(calls.length, 2);
  assert.deepEqual(auto_batches, [["reply:first", "reply:second"]]);
  await city.close();
});

test("响应图依赖没有有效回复时不会继续投递下游节点", async () => {
  RecordingSession.created = [];
  class EmptySession extends Session {
    async prompt() {
      RecordingSession.created.push({ agent_id: this.agent_id, query: "architect" });
      return {
        id: `turn-${this.id}`,
        result: null,
        finished: Promise.resolve({ turn_id: `turn-${this.id}`, text: "", success: true }),
      };
    }
  }
  const city = new City();
  const architect = new Agent({ id: "architect", session_class: EmptySession });
  const reviewer = new Agent({ id: "reviewer", session_class: RecordingSession });
  city.agents.add(architect);
  city.agents.add(reviewer);
  const group = new Group({
    id: "dependency-empty-group",
    members: [architect, reviewer],
    dispatch_strategy: {
      decide_dispatch: ({ trigger }) => trigger === "user"
        ? {
          nodes: [
            { node_id: "architect", member_ids: ["architect"], response_mode: "single", depends_on_node_ids: [], instruction: "先分析。" },
            { node_id: "reviewer", member_ids: ["reviewer"], response_mode: "single", depends_on_node_ids: ["architect"], instruction: "仅基于分析回复。" },
          ],
          terminal: true,
        }
        : { nodes: [], terminal: true },
    },
  });
  city.groups.add(group);
  const group_session = await group.sessions.create();
  await group_session.prompt({ query: "请分析并审查" });
  await wait_for_group_idle(group_session);
  assert.deepEqual(RecordingSession.created.map((entry) => entry.agent_id), ["architect"]);
  await city.close();
});

test("auto dispatch 检测重复路由并停止传播", async () => {
  RecordingSession.created = [];
  let auto_calls = 0;
  const city = new City();
  const agent = new Agent({ id: "loop-agent", session_class: RecordingSession });
  city.agents.add(agent);
  const group = new Group({
    id: "loop-group",
    members: [agent],
    dispatch_strategy: {
      decide_dispatch: ({ trigger }) => trigger === "auto"
        ? {
          nodes: [{ node_id: "loop", member_ids: ["loop-agent"], response_mode: "single", depends_on_node_ids: [], instruction: "继续回复。" }],
          terminal: false,
        }
        : {
          nodes: [{ node_id: "initial", member_ids: ["loop-agent"], response_mode: "single", depends_on_node_ids: [], instruction: "回复一次。" }],
          terminal: false,
        },
    },
  });
  city.groups.add(group);
  const session = await group.sessions.create();
  const original_messages = await session.messages();
  await session.prompt({ query: "loop" });
  await wait_for_group_idle(session);
  const messages = await session.messages();
  auto_calls = messages.filter((message) => message.sender_type === "agent").length;
  assert.equal(auto_calls, 2);
  assert.match(messages.at(-1).text, /repeated path/);
  assert.equal(original_messages.length, 0);
  await city.close();
});

test("GroupSession stop 会停止正在执行的成员，但已写入的 prompt 保留", async () => {
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
  const group = new Group({ id: "stoppable-group", members: [agent], dispatch_strategy: test_dispatch_strategy });
  city.groups.add(group);
  const session = await group.sessions.create();
  const first = session.prompt({ query: "first" });
  await new Promise((resolve) => setTimeout(resolve, 0));
  const second = session.prompt({ query: "second" });
  await session.stop();
  await Promise.all([first, second]);
  assert.deepEqual(finished.map((query) => query.includes("Current message from user: first")), [true]);
  assert.deepEqual((await session.messages()).filter((message) => message.sender_type === "user").map((message) => message.text), ["first", "second"]);
  await city.close();
});
