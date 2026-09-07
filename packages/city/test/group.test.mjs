import test from "node:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import { Agent, Group, Session } from "@downcity/agent";
import { City } from "../bin/index.js";
import { LocalStorageProvider, Workspace } from "@downcity/city";
import { MockModelClient } from "../../agent/scripts/ModelClientMock.mjs";

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

async function wait_for_group_title(group_session, timeout_ms = 1000) {
  return await new Promise((resolve, reject) => {
    const unsubscribe = group_session.subscribe((event) => {
      if (event.type !== "title") return;
      clearTimeout(timer);
      unsubscribe();
      resolve(event.title);
    });
    const timer = setTimeout(() => {
      unsubscribe();
      reject(new Error("Timed out waiting for GroupSession title"));
    }, timeout_ms);
  });
}

// 测试专用策略：生产代码不再提供隐式规则调度，行为测试显式注入最小策略。
const test_dispatch_strategy = {
  decide_dispatch({ trigger, current_message, members }) {
    if (trigger === "auto") return create_test_decision();
    const collective = /你们|大家|各自|分别|同时|一起|所有人/.test(current_message.text);
    const selected_members = collective ? members : members.slice(0, 1);
    return create_test_decision([selected_members.map((member) => ({
      member_id: member.agent_id,
      instruction: "测试策略：直接完成当前任务，只代表自己发言。",
    }))]);
  },
};

function create_test_decision(stages = [], terminal = true, reason = "测试调度") {
  return {
    reason,
    stages: stages.map((assignments, stage_index) => ({
      stage_id: `test-stage-${stage_index}`,
      assignments,
    })),
    terminal,
  };
}

function create_dispatch_input(stages = [], next = "stop", reason = "测试调度") {
  return {
    reason,
    stages: stages.map((assignments) => ({ assignments })),
    next,
  };
}

function create_dispatch_tool_call(input, tool_call_id = "dispatch-call") {
  return {
    type: "tool_call",
    tool_call_id,
    tool_name: "dispatch_group",
    input,
  };
}

// Group.model 同时服务调度与标题；调度测试只声明调度响应，标题请求由统一包装器处理。
function create_dispatch_model(options) {
  return new MockModelClient({
    ...options,
    doGenerate: async (call) => {
      const dispatch_call = call.tools?.some((tool) => tool.name === "dispatch_group");
      if (dispatch_call) return await options.doGenerate(call);
      return {
        content: [{ type: "text", text: "测试群聊标题" }],
        finishReason: { unified: "stop", raw: "stop" },
        usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
        warnings: [],
      };
    },
  });
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
  const architect_sessions = await architect.sessions.list({ origin_type: "group" });
  assert.equal(architect_sessions.items.length, 1);
  assert.deepEqual(architect_sessions.items[0].origin, { type: "group", group_id: "delivery", group_session_id: group_session.id });
  await city.close();
});

test("Group.model uses AI dispatch to select only the returned members", async () => {
  RecordingSession.created = [];
  let dispatch_calls = 0;
  const model_calls = [];
  const dispatch_model = create_dispatch_model({
    modelId: "group-dispatch-model",
    doGenerate: async (call) => {
      model_calls.push(call);
      return {
        content: [create_dispatch_tool_call(dispatch_calls++ === 0
          ? create_dispatch_input([[{ member_id: "reviewer", instruction: "审查这个变更。" }]], "continue")
          : create_dispatch_input([], "stop", "审查已经完成"))],
        finishReason: { unified: "stop", raw: "stop" },
        usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
        warnings: [],
      };
    },
  });
  const city = new City();
  const architect = new Agent({ id: "architect", name: "架构师", description: "负责系统架构设计", session_class: RecordingSession });
  const reviewer = new Agent({ id: "reviewer", name: "审查员", description: "负责代码质量审查", session_class: RecordingSession });
  city.agents.add(architect);
  city.agents.add(reviewer);
  const group = new Group({
    id: "ai-delivery",
    name: "交付小组",
    instruction: "交付可靠的软件变更",
    model: dispatch_model,
    members: [architect, reviewer],
  });
  city.groups.add(group);
  const group_session = await group.sessions.create();
  await group_session.prompt({ query: "请审查这个变更" });
  await wait_for_group_idle(group_session);
  assert.deepEqual(RecordingSession.created.map((entry) => entry.agent_id), ["reviewer"]);
  const dispatch_prompt = model_calls[0].messages[1].content[0].text;
  assert.match(dispatch_prompt, /- 名称: 交付小组/);
  assert.match(dispatch_prompt, /- 目标: 交付可靠的软件变更/);
  assert.match(dispatch_prompt, /名称: 架构师\n  能力描述: 负责系统架构设计/);
  assert.match(dispatch_prompt, /名称: 审查员\n  能力描述: 负责代码质量审查/);
  assert.equal(dispatch_prompt.match(/请审查这个变更/g)?.length, 1);
  assert.match(model_calls[0].messages[0].content[0].text, /next=continue 仅用于下一步选择必须依赖本轮成员的实际输出/);
  assert.match(model_calls[0].messages[0].content[0].text, /stages=\[\]、next=stop/);
  assert.match(RecordingSession.created[0].query, /Group: 交付小组/);
  assert.match(RecordingSession.created[0].query, /Group objective: 交付可靠的软件变更/);
  assert.match(RecordingSession.created[0].query, /Your identity: 审查员 \(reviewer\)/);
  assert.match(RecordingSession.created[0].query, /Your description: 负责代码质量审查/);
  assert.match(RecordingSession.created[0].query, /Assignment:\n审查这个变更。/);
  assert.doesNotMatch(RecordingSession.created[0].query, /判断是否需要回复|如果不需要你发言/);
  await city.close();
});

test("AI Dispatch 返回空阶段计划时直接结束当前调度", async () => {
  RecordingSession.created = [];
  const dispatch_model = create_dispatch_model({
    modelId: "empty-dispatch-model",
    doGenerate: async () => ({
      content: [create_dispatch_tool_call(create_dispatch_input([], "stop", "用户意图已经满足"))],
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

test("自定义 Dispatch 不允许用空阶段计划继续传播", async () => {
  RecordingSession.created = [];
  const city = new City();
  const agent = new Agent({ id: "invalid-continuation-agent", session_class: RecordingSession });
  city.agents.add(agent);
  const group = new Group({
    id: "invalid-continuation-group",
    members: [agent],
    dispatch_strategy: {
      decide_dispatch: () => ({
        reason: "等待未知后续结果",
        stages: [],
        terminal: false,
      }),
    },
  });
  city.groups.add(group);
  const group_session = await group.sessions.create();
  await group_session.prompt({ query: "请回答" });
  await wait_for_group_idle(group_session);

  assert.deepEqual(RecordingSession.created, []);
  assert.match((await group_session.messages()).at(-1).text, /cannot continue without any stage/);
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
  const dispatch_model = create_dispatch_model({
    modelId: "failing-dispatch-model",
    doGenerate: async () => ({
      content: [{ type: "error", error: "dispatch unavailable" }],
    }),
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
  const dispatch_model = create_dispatch_model({
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

test("AI Dispatch 在同一调度 Turn 内纠正未调用工具的响应", async () => {
  RecordingSession.created = [];
  let dispatch_calls = 0;
  const dispatch_model = create_dispatch_model({
    modelId: "recovering-dispatch-model",
    doGenerate: async (call) => {
      dispatch_calls += 1;
      if (dispatch_calls === 1) {
        return {
          content: [{ type: "text", text: "我建议让 responder 回复。" }],
          finishReason: { unified: "stop", raw: "stop" },
          usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
          warnings: [],
        };
      }
      assert.equal(call.messages.some((message) => (
        message.role === "user" && message.content.some((part) => (
          part.type === "text" && part.text.includes("上一响应不符合调度协议")
        ))
      )), true);
      return {
        content: [create_dispatch_tool_call(create_dispatch_input([[
          { member_id: "responder", instruction: "直接回答用户问题。" },
        ]]))],
        finishReason: { unified: "tool-calls", raw: "tool_calls" },
        usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
        warnings: [],
      };
    },
  });
  const city = new City();
  const agent = new Agent({ id: "responder", session_class: RecordingSession });
  city.agents.add(agent);
  const group = new Group({ id: "recovering-dispatch-group", model: dispatch_model, members: [agent] });
  city.groups.add(group);
  const group_session = await group.sessions.create();

  await group_session.prompt({ query: "请回答" });
  await wait_for_group_idle(group_session);

  assert.equal(dispatch_calls, 2);
  assert.deepEqual(RecordingSession.created.map((entry) => entry.agent_id), ["responder"]);
  assert.equal((await group_session.messages()).some((message) => message.sender_type === "system"), false);
  await city.close();
});

test("AI Dispatch 拒绝未知成员并允许跨阶段重复投递", async () => {
  const inputs = [
    { input: create_dispatch_input([[{ member_id: "unknown", instruction: "回答。" }]]), expected_agent_ids: [] },
    { input: create_dispatch_input([
      [{ member_id: "known", instruction: "先分析。" }],
      [{ member_id: "known", instruction: "再收口。" }],
    ]), expected_agent_ids: ["known", "known"] },
  ];
  for (const [index, { input, expected_agent_ids }] of inputs.entries()) {
    RecordingSession.created = [];
    let dispatch_calls = 0;
    const dispatch_model = create_dispatch_model({
      modelId: `invalid-dispatch-model-${index}`,
      doGenerate: async () => ({
        content: [create_dispatch_tool_call(expected_agent_ids.length > 0 && dispatch_calls++ > 0
          ? create_dispatch_input()
          : input)],
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

    if (expected_agent_ids.length === 0) {
      assert.match((await group_session.messages()).at(-1).text, /Group dispatch model failed:/);
    } else {
      assert.deepEqual(RecordingSession.created.map((entry) => entry.agent_id), expected_agent_ids);
    }
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

test("GroupSession 基于首条用户消息生成并持久化 canonical title", async () => {
  RecordingSession.created = [];
  const root_path = await fs.mkdtemp(path.join(os.tmpdir(), "downcity-group-title-"));
  let title_calls = 0;
  const title_model = new MockModelClient({
    modelId: "group-title-model",
    doGenerate: async (call) => {
      title_calls += 1;
      assert.equal(call.tools, undefined);
      assert.match(call.messages[1].content[0].text, /请评审登录流程/);
      return {
        content: [{ type: "text", text: "登录流程评审" }],
        finishReason: { unified: "stop", raw: "stop" },
        usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
        warnings: [],
      };
    },
  });
  const city = new City({ storage: new LocalStorageProvider(root_path) });
  const agent = new Agent({ id: "title-agent", session_class: RecordingSession });
  city.agents.add(agent);
  const group = new Group({
    id: "title-group",
    model: title_model,
    members: [agent],
    dispatch_strategy: test_dispatch_strategy,
  });
  city.groups.add(group);
  const group_session = await group.sessions.create();
  const generated_title = wait_for_group_title(group_session);
  await group_session.prompt({ query: "请评审登录流程" });
  await wait_for_group_idle(group_session);
  assert.equal(await generated_title, "登录流程评审");
  assert.equal(title_calls, 1);
  assert.deepEqual((await group.sessions.list()).map(({ title, preview_text }) => ({ title, preview_text })), [{
    title: "登录流程评审",
    preview_text: "reply:title-agent",
  }]);

  const renamed_title = wait_for_group_title(group_session);
  assert.equal(await group_session.rename("  登录上线检查  "), "登录上线检查");
  assert.equal(await renamed_title, "登录上线检查");
  await group_session.prompt({ query: "继续评审" });
  await wait_for_group_idle(group_session);
  assert.equal(title_calls, 1);
  await city.close();

  const restored_city = new City({ storage: new LocalStorageProvider(root_path) });
  const restored_agent = new Agent({ id: "title-agent", session_class: RecordingSession });
  restored_city.agents.add(restored_agent);
  const restored_group = new Group({ id: "title-group", members: [restored_agent], dispatch_strategy: test_dispatch_strategy });
  restored_city.groups.add(restored_group);
  assert.equal((await restored_group.sessions.list())[0].title, "登录上线检查");
  await restored_city.close();
  await fs.rm(root_path, { recursive: true, force: true });
});

test("GroupSession 标题生成失败后可重试且不会覆盖手动标题", async () => {
  let title_calls = 0;
  let resolve_generation;
  const title_model = new MockModelClient({
    modelId: "retry-title-model",
    doGenerate: async () => {
      title_calls += 1;
      if (title_calls === 1) {
        return {
          content: [],
          finishReason: { unified: "stop", raw: "stop" },
          usage: { inputTokens: 1, outputTokens: 0, totalTokens: 1 },
          warnings: [],
        };
      }
      return await new Promise((resolve) => { resolve_generation = resolve; });
    },
  });
  const city = new City();
  const agent = new Agent({ id: "retry-title-agent", session_class: RecordingSession });
  city.agents.add(agent);
  const group = new Group({ id: "retry-title-group", model: title_model, members: [agent], dispatch_strategy: test_dispatch_strategy });
  city.groups.add(group);
  const group_session = await group.sessions.create();
  await group_session.prompt({ query: "首次标题请求" });
  await wait_for_group_idle(group_session);
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal((await group.sessions.list())[0].title, undefined);

  await group_session.prompt({ query: "触发标题重试" });
  while (!resolve_generation) await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(await group_session.rename("用户指定标题"), "用户指定标题");
  resolve_generation({
    content: [{ type: "text", text: "模型迟到标题" }],
    finishReason: { unified: "stop", raw: "stop" },
    usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
    warnings: [],
  });
  await wait_for_group_idle(group_session);
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal((await group.sessions.list())[0].title, "用户指定标题");
  assert.equal(title_calls, 2);
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
  const sessions = await agent.sessions.list({ workspace_id: "shared-project", origin_type: "group" });
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

test("GroupSession 持久化自己的调度 Turn", async () => {
  RecordingSession.created = [];
  const root_path = await fs.mkdtemp(path.join(os.tmpdir(), "downcity-group-dispatch-session-"));
  const city = new City({ storage: new LocalStorageProvider(root_path) });
  const agent = new Agent({ id: "dispatch-member", session_class: RecordingSession });
  city.agents.add(agent);
  const group = new Group({ id: "dispatch-session-group", members: [agent], dispatch_strategy: test_dispatch_strategy });
  city.groups.add(group);
  const session = await group.sessions.create();

  await session.prompt({ query: "persist dispatch" });
  await wait_for_group_idle(session);

  const turns_path = path.join(
    root_path,
    "groups",
    "dispatch-session-group",
    "sessions",
    encodeURIComponent(session.id),
    "dispatch",
    "turns.jsonl",
  );
  const records = (await fs.readFile(turns_path, "utf8"))
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  const user_records = records.filter((record) => record.trigger === "user");
  assert.deepEqual(user_records.map((record) => record.status), ["queued", "running", "completed"]);
  assert.deepEqual(user_records.at(-1).decision.stages[0].assignments, [{
    member_id: "dispatch-member",
    instruction: "测试策略：直接完成当前任务，只代表自己发言。",
  }]);
  assert.equal(
    (await session.messages()).find((message) => message.sender_type === "agent").dispatch_id,
    user_records.at(-1).dispatch_id,
  );
  await city.close();
  await fs.rm(root_path, { recursive: true, force: true });
});

test("GroupSession stop 会中断当前调度且不记录失败消息", async () => {
  const root_path = await fs.mkdtemp(path.join(os.tmpdir(), "downcity-group-dispatch-stop-"));
  let dispatch_started = false;
  let dispatch_aborted = false;
  let dispatch_invocations = 0;
  const strategy = {
    async decide_dispatch({ abort_signal }) {
      dispatch_invocations += 1;
      dispatch_started = true;
      await new Promise((resolve, reject) => {
        const abort = () => {
          dispatch_aborted = true;
          reject(abort_signal.reason);
        };
        if (abort_signal.aborted) abort();
        else abort_signal.addEventListener("abort", abort, { once: true });
      });
      return create_test_decision();
    },
  };
  const city = new City({ storage: new LocalStorageProvider(root_path) });
  const agent = new Agent({ id: "unused-member", session_class: RecordingSession });
  city.agents.add(agent);
  const group = new Group({ id: "dispatch-stop-group", members: [agent], dispatch_strategy: strategy });
  city.groups.add(group);
  const session = await group.sessions.create();
  await session.prompt({ query: "stop dispatch" });
  await session.prompt({ query: "cancel queued dispatch" });
  for (let attempt = 0; attempt < 200 && !dispatch_started; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }

  await session.stop();

  assert.equal(dispatch_aborted, true);
  assert.equal(dispatch_invocations, 1);
  assert.deepEqual((await session.messages()).map((message) => message.text), [
    "stop dispatch",
    "cancel queued dispatch",
  ]);
  const turns_path = path.join(
    root_path,
    "groups",
    "dispatch-stop-group",
    "sessions",
    encodeURIComponent(session.id),
    "dispatch",
    "turns.jsonl",
  );
  const records = (await fs.readFile(turns_path, "utf8"))
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  const latest_records = new Map(records.map((record) => [record.dispatch_id, record]));
  assert.equal(latest_records.size, 2);
  assert.deepEqual([...latest_records.values()].map((record) => record.status), ["stopped", "stopped"]);
  await city.close();
  await fs.rm(root_path, { recursive: true, force: true });
});

test("GroupSession 恢复时重新执行中断的用户调度", async () => {
  RecordingSession.created = [];
  const root_path = await fs.mkdtemp(path.join(os.tmpdir(), "downcity-group-dispatch-recovery-"));
  let original_abort_signal;
  let original_dispatch_started = false;
  const original_city = new City({ storage: new LocalStorageProvider(root_path) });
  const original_agent = new Agent({ id: "recovery-member", session_class: RecordingSession });
  original_city.agents.add(original_agent);
  const original_group = new Group({
    id: "dispatch-recovery-group",
    members: [original_agent],
    dispatch_strategy: {
      async decide_dispatch({ abort_signal }) {
        original_abort_signal = abort_signal;
        original_dispatch_started = true;
        await new Promise((resolve, reject) => {
          abort_signal.addEventListener("abort", () => reject(abort_signal.reason), { once: true });
        });
        return create_test_decision();
      },
    },
  });
  original_city.groups.add(original_group);
  const original_session = await original_group.sessions.create();
  await original_session.prompt({ query: "recover dispatch" });
  for (let attempt = 0; attempt < 200 && !original_dispatch_started; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }

  const restored_city = new City({ storage: new LocalStorageProvider(root_path) });
  const restored_agent = new Agent({ id: "recovery-member", session_class: RecordingSession });
  restored_city.agents.add(restored_agent);
  const restored_group = new Group({
    id: "dispatch-recovery-group",
    members: [restored_agent],
    dispatch_strategy: test_dispatch_strategy,
  });
  restored_city.groups.add(restored_group);
  const restored_session = await restored_group.sessions.get(original_session.id);
  assert.ok(restored_session);
  await wait_for_group_idle(restored_session);

  assert.deepEqual(RecordingSession.created.map((entry) => entry.agent_id), ["recovery-member"]);
  assert.deepEqual((await restored_session.messages()).map((message) => message.text), [
    "recover dispatch",
    "reply:recovery-member",
  ]);
  await original_session.stop();
  assert.equal(original_abort_signal.aborted, true);
  await restored_city.close();
  await original_city.close();
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

test("GroupSession 列表首次读取时将 v1 metadata 原子迁移为 v2", async () => {
  const root_path = await fs.mkdtemp(path.join(os.tmpdir(), "downcity-group-metadata-migration-"));
  const group_id = "metadata-migration-group";
  const session_id = "legacy-session";
  const session_path = path.join(root_path, "groups", group_id, "sessions", session_id);
  const meta_path = path.join(session_path, "meta.json");
  await fs.mkdir(session_path, { recursive: true });
  await fs.writeFile(meta_path, `${JSON.stringify({
    v: 1,
    session_id,
    group_id,
    created_at: 1,
    updated_at: 2,
    message_count: 1,
    preview_text: "legacy message",
    pending_turns: [{
      turn_id: "legacy-turn",
      root_message_id: "legacy-message",
      context_message_ids: [],
    }],
    auto_frontier_message_ids: ["legacy-reply"],
  }, null, 2)}\n`);

  const city = new City({ storage: new LocalStorageProvider(root_path) });
  const agent = new Agent({ id: "metadata-agent", session_class: RecordingSession });
  city.agents.add(agent);
  const group = new Group({ id: group_id, members: [agent], dispatch_strategy: test_dispatch_strategy });
  city.groups.add(group);

  assert.deepEqual(await group.sessions.list(), [{
    id: session_id,
    group_id,
    created_at: 1,
    updated_at: 2,
    message_count: 1,
    preview_text: "legacy message",
  }]);
  const migrated_metadata = JSON.parse(await fs.readFile(meta_path, "utf8"));
  assert.equal(migrated_metadata.v, 2);
  assert.deepEqual(migrated_metadata.pending_turns, [{
    turn_id: "legacy-turn",
    root_message_id: "legacy-message",
    context_message_ids: [],
    dispatch_stage: "auto",
  }]);
  assert.deepEqual(migrated_metadata.auto_frontier_message_ids, ["legacy-reply"]);
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
  assert.equal(calls.some((query) => query.includes("Current message:\nuser: first")), true);
  assert.equal(calls.some((query) => query.includes("Current message:\nuser: second")), true);
  assert.deepEqual((await session.messages()).filter((message) => message.sender_type === "user").map((message) => message.text), ["first", "second"]);
  await city.close();
});

test("Dispatch 阶段按顺序传递上一个成员的回复", async () => {
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
        ? create_test_decision([
          [{ member_id: "architect", instruction: "先分析。" }],
          [{ member_id: "reviewer", instruction: "基于前一个成员的回复审查。" }],
        ])
        : create_test_decision(),
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

test("Dispatch 允许同一成员在不同阶段重复参与", async () => {
  RecordingSession.created = [];
  const city = new City();
  const members = ["a", "d", "e", "f"].map((id) => new Agent({ id, session_class: RecordingSession }));
  for (const member of members) city.agents.add(member);
  const group = new Group({
    id: "repeated-member-group",
    members,
    dispatch_strategy: {
      decide_dispatch: ({ trigger }) => trigger === "user"
        ? create_test_decision([
          [{ member_id: "a", instruction: "第一阶段。" }],
          [{ member_id: "d", instruction: "第二阶段。" }],
          [{ member_id: "a", instruction: "第三阶段。" }],
          [{ member_id: "e", instruction: "第四阶段。" }],
          [{ member_id: "f", instruction: "第五阶段。" }],
        ])
        : create_test_decision(),
    },
  });
  city.groups.add(group);
  const group_session = await group.sessions.create();
  await group_session.prompt({ query: "执行多阶段流程" });
  await wait_for_group_idle(group_session);
  assert.deepEqual(RecordingSession.created.map((entry) => entry.agent_id), ["a", "d", "a", "e", "f"]);
  assert.match(RecordingSession.created[2].query, /d: reply:d/);
  assert.match(RecordingSession.created[4].query, /e: reply:e/);
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
          return create_test_decision();
        }
        return create_test_decision([[
          { member_id: "batch-agent", instruction: "回复当前消息。" },
        ]], false);
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

test("成员返回空内容时记录失败且不继续投递下游节点", async () => {
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
        ? create_test_decision([
          [{ member_id: "architect", instruction: "先分析。" }],
          [{ member_id: "reviewer", instruction: "仅基于分析回复。" }],
        ])
        : create_test_decision(),
    },
  });
  city.groups.add(group);
  const group_session = await group.sessions.create();
  await group_session.prompt({ query: "请分析并审查" });
  await wait_for_group_idle(group_session);
  assert.deepEqual(RecordingSession.created.map((entry) => entry.agent_id), ["architect"]);
  assert.deepEqual((await group_session.messages()).map((message) => [message.sender_type, message.text]), [
    ["user", "请分析并审查"],
    ["system", "architect 执行失败：未生成有效回复"],
  ]);
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
        ? create_test_decision([[
          { member_id: "loop-agent", instruction: "继续回复。" },
        ]], false)
        : create_test_decision([[
          { member_id: "loop-agent", instruction: "回复一次。" },
        ]], false),
    },
  });
  city.groups.add(group);
  const session = await group.sessions.create();
  const original_messages = await session.messages();
  await session.prompt({ query: "loop" });
  await wait_for_group_idle(session);
  const messages = await session.messages();
  auto_calls = messages.filter((message) => message.sender_type === "agent").length;
  assert.equal(auto_calls, 3);
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
  assert.deepEqual(finished.map((query) => query.includes("Current message:\nuser: first")), [true]);
  assert.deepEqual((await session.messages()).filter((message) => message.sender_type === "user").map((message) => message.text), ["first", "second"]);
  await city.close();
});
