/** Power 单实例宿主 actions 与凭据边界测试。 */

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { MessengerPower } from "@downcity/powers/messenger";
import { SkillPower } from "@downcity/powers/skill";
import { TaskPower } from "@downcity/powers/task";
import { NotificationPower } from "../bin/notification.js";
import { InboxStore } from "../bin/notification/renderer/InboxStore.js";
import { inbox_entries } from "../bin/notification/renderer/InboxEntries.js";
import { createTaskDefinition } from "../bin/task/Action.js";
import { TaskDefinitionRepository } from "../bin/task/runtime/TaskDefinitionRepository.js";
import { TaskExecutionCoordinator } from "../bin/task/runtime/TaskExecutionCoordinator.js";
import { LocalStorageProvider, City, Agent, Workspace } from "@downcity/city";
import { AskQuestionsTool } from "@downcity/agent/tools";
import { MockModelClient } from "../../../agent/scripts/ModelClientMock.mjs";

/** 启动 Messenger Power 并返回按 ID 注册的配置 action。 */
async function start_messenger_power() {
  const actions = new Map();
  await new MessengerPower().initialize({
    power: {
      id: "messenger",
      action() {},
      config_action(action) {
        actions.set(action.id, action);
      },
    },
    logger: {
      debug() {},
      info() {},
      warn() {},
      error() {},
    },
    system: {
      async list_agents() { return []; },
      async list_workspaces() { return []; },
      async invoke_agent_power() { return {}; },
      async append_agent_session_message() {},
      async open_external() {},
      async show_item_in_folder() {},
      async write_clipboard_text() {},
    },
  });
  return actions;
}

/** 启动 Skill Power，并注入测试 Agent 与 Workspace。 */
async function start_skill_power(data_root_path, workspace_path) {
  const actions = new Map();
  await new SkillPower().initialize({
    power: {
      id: "skill",
      action(action) { actions.set(action.id, action); },
      config_action() {},
    },
    config: { get: () => ({}), set: async () => {} },
    storage: { path: data_root_path, files: {} },
    data_root_path,
    logger: {
      debug() {},
      info() {},
      warn() {},
      error() {},
    },
    notifications: { publish: async () => {} },
    system: {
      async list_agents() { return [{ agent_id: "test-agent", name: "Test Agent" }]; },
      async list_workspaces() {
        return [{ workspace_id: "test", name: "Test", workspace_path }];
      },
      async invoke_agent_power() { return {}; },
      async append_agent_session_message() {},
      async open_external() {},
      async show_item_in_folder() {},
      async write_clipboard_text() {},
    },
  });
  return actions;
}

/** 启动 Task Power，并记录对指定 Agent 执行范围的调用。 */
async function start_task_power(options = {}) {
  const actions = new Map();
  const invocations = [];
  const data_path = fs.mkdtempSync(path.join(os.tmpdir(), "downcity-task-host-actions-"));
  const task_scope = new LocalStorageProvider(data_path).open_scope(["powers", "task"]);
  const storage = { path: task_scope.root_path, files: task_scope.files };
  const definitions_repository = new TaskDefinitionRepository(
    storage,
    new TaskExecutionCoordinator(),
  );
  const created = await createTaskDefinition({
    definitions: definitions_repository,
    agent_id: "task-agent",
    request: {
      title: "daily-report",
      body: "汇总今天的进展",
      when: "@manual",
      schedule: "enabled",
      kind: "agent",
      review: false,
      workspace_id: "workspace-b",
    },
    delivery_session: {
      agent_id: "task-agent",
      workspace_id: "workspace-b",
      session_id: "daily-report",
      category: "work",
    },
  });
  const run_path = path.join(storage.path, "tasks", created.task_id, "20260901-080000-000");
  fs.mkdirSync(run_path, { recursive: true });
  fs.writeFileSync(path.join(run_path, "output.md"), "# Task Output\n日报正文\n");
  fs.writeFileSync(path.join(run_path, "run.json"), JSON.stringify({
    v: 1,
    taskId: created.task_id,
    timestamp: "20260901-080000-000",
    executionId: "daily-report:1",
    agent_id: "task-agent",
    workspace_id: "workspace-b",
    trigger: { type: "manual" },
    status: "success",
    executionStatus: "success",
    resultStatus: "valid",
    dialogueRounds: 1,
    userSimulatorSatisfied: true,
    startedAt: 1_788_246_000_000,
    endedAt: 1_788_246_001_000,
  }));
  const power = new TaskPower();
  await power.initialize({
    power: {
      id: "task",
      action(action) { actions.set(action.id, action); },
      config_action() {},
    },
    logger: {
      log: async () => {},
      debug() {},
      info() {},
      warn() {},
      error() {},
    },
    storage,
    notifications: {
      publish: async () => {},
      dismiss: options.dismiss_notification || (async () => {}),
    },
    system: {
      async list_agents() {
        return options.agents || [
          { agent_id: "task-agent", name: "Task Agent" },
          { agent_id: "empty-task-agent", name: "Empty Task Agent" },
          { agent_id: "chat-agent", name: "Chat Agent" },
        ];
      },
      async list_workspaces() {
        return options.workspaces || [
          { workspace_id: "workspace-a", name: "Workspace A", workspace_path: "/workspace-a" },
          { workspace_id: "workspace-b", name: "Workspace B", workspace_path: "/workspace-b" },
        ];
      },
      async invoke_agent_power(input) {
        invocations.push(input);
        return { success: true, data: { accepted: true } };
      },
      async append_agent_session_message() {},
      async open_external() {},
      async show_item_in_folder() {},
      async write_clipboard_text() {},
    },
  });
  return {
    power,
    actions,
    invocations,
    storage,
    cleanup: async () => {
      await power.dispose();
      fs.rmSync(data_path, { recursive: true, force: true });
    },
  };
}

/** 创建可观察完整替换结果的唯一配置上下文。 */
function create_config_context(initial_config) {
  let config = structuredClone(initial_config);
  return {
    context: {
      config: {
        get() {
          return structuredClone(config);
        },
        async set(next) {
          config = structuredClone(next);
        },
      },
    },
    read: () => structuredClone(config),
  };
}

test("Messenger Power 读取配置时不泄漏 Channel 凭据", async () => {
  const actions = await start_messenger_power();
  const store = create_config_context({
    channels: [
      { id: "telegram_main", type: "telegram", name: "Main", bot_token: "telegram-secret" },
      { id: "feishu_main", type: "feishu", name: "Work", app_id: "cli_a", app_secret: "feishu-secret" },
    ],
  });

  const config = await actions.get("config.read").run(undefined, store.context);

  assert.equal(JSON.stringify(config).includes("telegram-secret"), false);
  assert.equal(JSON.stringify(config).includes("feishu-secret"), false);
  assert.deepEqual(config.channels.map((channel) => channel.secret_configured), [true, true]);
});

test("Messenger Power 保存时为空的凭据输入会保留已有凭据", async () => {
  const actions = await start_messenger_power();
  const store = create_config_context({
    channels: [
      { id: "telegram_main", type: "telegram", name: "Old", bot_token: "kept-secret" },
    ],
  });

  const result = await actions.get("config.save").run({
    owner_agent_id: "task-agent",
    owner_workspace_id: "workspace-b",
    queue: { max_concurrency: 4 },
    channels: [{
      id: "telegram_main",
      type: "telegram",
      name: "New",
      bot_token: "",
      secret_configured: true,
    }],
  }, store.context);

  assert.equal(store.read().channels[0].bot_token, "kept-secret");
  assert.equal(result.channels[0].secret_configured, true);
  assert.equal("bot_token" in result.channels[0], false);
});

test("Messenger Power 拒绝没有凭据的新 Channel", async () => {
  const actions = await start_messenger_power();
  const store = create_config_context({ channels: [] });

  await assert.rejects(
    () => actions.get("config.save").run({
      queue: {},
      channels: [{ id: "telegram_new", type: "telegram", name: "New" }],
    }, store.context),
    /Telegram Bot Token is required/u,
  );
});

test("Skill Power 按 Agent 浏览、关联与读取 Skill", async () => {
  const base_path = fs.mkdtempSync(path.join(os.tmpdir(), "downcity-skill-main-"));
  const workspace_path = path.join(base_path, "workspace");
  const home_path = path.join(base_path, "home");
  const home_skill_path = path.join(home_path, ".agents", "skills", "home-demo");
  fs.mkdirSync(home_skill_path, { recursive: true });
  fs.writeFileSync(path.join(home_skill_path, "SKILL.md"), "---\nname: Home Demo\ndescription: Home example\n---\n\n# Home Demo\n");
  // Skill 的用户目录来源读取真实 HOME，因此本用例内固定它，并在结束时恢复。
  const previous_home = process.env.HOME;
  process.env.HOME = home_path;
  try {
    const actions = await start_skill_power(base_path, workspace_path);

    // 初始状态：Agent 目录为空，但用户目录里已有可关联的 Skill。
    const before = await actions.get("skill.snapshot").run();
    assert.deepEqual(before.agents[0].skills, []);
    const before_available = before.available.find((item) => item.id === "home-demo");
    assert.ok(before_available, "可关联列表未包含用户目录 Skill");
    assert.deepEqual(before_available.linked_agent_ids, []);

    // 关联后该 Agent 即可见，且标出软链接。
    const linked = await actions.get("skill.link").run({
      agent_id: "test-agent",
      skill_id: "home-demo",
    });
    assert.equal(linked.operation_success, true);
    assert.deepEqual(
      linked.agents[0].skills.map((skill) => `${skill.id}:${skill.is_link}`),
      ["home-demo:true"],
    );
    assert.deepEqual(
      linked.available.find((item) => item.id === "home-demo").linked_agent_ids,
      ["test-agent"],
    );

    const result = await actions.get("skill.read").run({
      agent_id: "test-agent",
      skill_id: "home-demo",
    });
    assert.equal(result.success, true);
    assert.match(result.content, /# Home Demo/u);

    // 移除只删链接，不动用户目录。
    const removed = await actions.get("skill.remove").run({ agent_id: "test-agent", skill_id: "home-demo" });
    assert.equal(removed.operation_success, true);
    assert.deepEqual(removed.agents[0].skills, []);
    assert.deepEqual(removed.available.find((item) => item.id === "home-demo").linked_agent_ids, []);
    assert.equal(fs.existsSync(path.join(home_skill_path, "SKILL.md")), true);
  } finally {
    if (previous_home === undefined) delete process.env.HOME;
    else process.env.HOME = previous_home;
    fs.rmSync(base_path, { recursive: true, force: true });
  }
});

test("Task Power 返回统一 Task 列表和可选执行目标", async () => {
  const { actions, invocations, cleanup } = await start_task_power();
  try {
    const snapshot = await actions.get("tasks.snapshot").run();
    assert.deepEqual(snapshot.tasks, [{
      task_id: snapshot.tasks[0].task_id,
      title: "daily-report",
      body: "汇总今天的进展",
      when: "@manual",
      schedule: "enabled",
      kind: "agent",
      review: false,
      agent_id: "task-agent",
      workspace_id: "workspace-b",
      delivery_session: {
        agent_id: "task-agent",
        workspace_id: "workspace-b",
        session_id: "daily-report",
        category: "work",
      },
      last_run_at: "20260901-080000-000",
    }]);
    assert.deepEqual(snapshot.agents, [
      { agent_id: "task-agent", name: "Task Agent" },
      { agent_id: "empty-task-agent", name: "Empty Task Agent" },
      { agent_id: "chat-agent", name: "Chat Agent" },
    ]);
    assert.deepEqual(snapshot.workspaces, [
    { workspace_id: "workspace-a", name: "Workspace A" },
    { workspace_id: "workspace-b", name: "Workspace B" },
  ]);
    assert.deepEqual(invocations, []);
  } finally {
    await cleanup();
  }
});

test("Task Power 使用 Task 自身 Workspace 完成管理操作", async () => {
  const { actions, invocations, cleanup } = await start_task_power({
    dismiss_notification: async () => {
      throw new Error("notification unavailable");
    },
  });
  try {
    await actions.get("tasks.create").run({
    agent_id: "task-agent",
    workspace_id: "workspace-b",
    title: "weekly-review",
    when: "@manual",
    kind: "agent",
    review: true,
    schedule: "paused",
    body: "汇总本周进展",
  });
  await actions.get("tasks.update").run({
    agent_id: "empty-task-agent",
    workspace_id: "workspace-a",
    current_title: "weekly-review",
    title: "weekly-review",
    when: "0 18 * * 5",
    kind: "agent",
    review: false,
    schedule: "enabled",
    body: "输出更新后的周报",
  });
  await actions.get("tasks.status").run({ task_title: "weekly-review", status: "paused" });
  await actions.get("tasks.run").run({ task_title: "weekly-review" });
    await actions.get("tasks.delete").run({ task_title: "weekly-review" });
    assert.deepEqual(invocations.map((invocation) => ({ agent_id: invocation.agent_id, workspace_id: invocation.workspace_id, action_id: invocation.action_id, input: invocation.input })), [
      { agent_id: "empty-task-agent", workspace_id: "workspace-a", action_id: "run", input: { title: "weekly-review" } },
    ]);
  } finally {
    await cleanup();
  }
});

test("Task Power 直接从统一 Store 读取执行记录与详情", async () => {
  const { actions, invocations, cleanup } = await start_task_power();
  const context = {
    task_title: "daily-report",
  };

  try {
    const history = await actions.get("tasks.history").run(context);
    assert.equal(history.runs[0].status, "success");
    const detail = await actions.get("tasks.run_detail").run({
      ...context,
      timestamp: "20260901-080000-000",
    });
    assert.equal(detail.run.output, "日报正文");
    assert.deepEqual(invocations, []);
  } finally {
    await cleanup();
  }
});

test("Task Power 保留目标失效的 Task 并允许宿主删除", async () => {
  const { actions, cleanup } = await start_task_power({
    agents: [{ agent_id: "another-agent", name: "Another Agent" }],
    workspaces: [{ workspace_id: "workspace-a", name: "Workspace A", workspace_path: "/workspace-a" }],
  });
  try {
    const snapshot = await actions.get("tasks.snapshot").run();
    assert.equal(snapshot.tasks[0].agent_id, "task-agent");
    assert.equal(snapshot.tasks[0].workspace_id, "workspace-b");
    await actions.get("tasks.delete").run({ task_title: "daily-report" });
    assert.deepEqual((await actions.get("tasks.snapshot").run()).tasks, []);
  } finally {
    await cleanup();
  }
});

test("Task Power 暴露并允许删除损坏定义", async () => {
  const { actions, storage, cleanup } = await start_task_power();
  const invalid_task_path = path.join(storage.path, "tasks", "broken-task");
  try {
    fs.mkdirSync(invalid_task_path, { recursive: true });
    fs.writeFileSync(path.join(invalid_task_path, "task.toml"), "invalid task definition");

    const snapshot = await actions.get("tasks.snapshot").run();
    assert.equal(snapshot.tasks.some((task) => task.title === "daily-report"), true);
    assert.deepEqual(snapshot.issues.map((issue) => issue.task_id), ["broken-task"]);
    const healthy_result = await actions.get("tasks.status").run({
      task_title: "daily-report",
      status: "paused",
    });
    assert.equal(healthy_result.task_title, "daily-report");

    const result = await actions.get("tasks.invalid.delete").run({ task_id: "broken-task" });
    assert.equal(result.task_id, "broken-task");
    assert.equal(result.scheduler.reloaded, true);
    assert.deepEqual((await actions.get("tasks.snapshot").run()).issues, []);
  } finally {
    await cleanup();
  }
});

test("Inbox仅管理通知阅读状态，响应回到原Interaction且通知重投幂等", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "downcity-notification-"));
  const scope = new LocalStorageProvider(root).open_scope(["notification"]);
  const actions = new Map();
  const power = new NotificationPower();
  let receiver;
  let pending = [{ reference: { session_category: "work", session_id: "s", turn_id: "t", interaction_id: "i" }, interaction: { status: "pending" } }];
  let responded;
  const context = {
    storage: { path: scope.root_path, files: scope.files },
    power: { action: (action) => actions.set(action.id, action) },
    logger: { warn() {} },
    system: {
      register_notification_receiver: (value) => { receiver = value; return () => { receiver = undefined; }; },
      list_agents: async () => [{ agent_id: "a", name: "Agent" }],
      list_agent_interactions: async () => pending,
      respond_agent_interaction: async (input) => { responded = input; pending = []; return { status: "resolved" }; },
    },
  };
  try {
    power.initialize(context);
    assert.deepEqual(Object.keys(power.actions), []);
    const source = { power_id: "task", agent_id: "a" };
    const input = { topic_key: "run-1", title: "Done", body: "result" };
    await receiver.publish(source, input);
    const first = await actions.get("notification.list").run({});
    assert.equal(first.items.length, 1);
    assert.equal(first.interactions.length, 1);
    await actions.get("notification.read").run({ notification_id: first.items[0].notification_id });
    await receiver.publish(source, input);
    const read = await actions.get("notification.list").run({});
    assert.equal(read.items.length, 1);
    assert.equal(read.items[0].read, true);
    assert.equal(read.interactions.length, 1);
    const request = { agent_id: "a", reference: pending[0].reference, response: { type: "question", outcome: "resolved", payload: { answers: [] } } };
    await actions.get("notification.respond").run(request);
    assert.deepEqual(responded, request);
    const resolved = await actions.get("notification.list").run({});
    assert.equal(resolved.interactions.length, 0);
    assert.equal(resolved.agent_names.a, "Agent");
    assert.equal(inbox_entries(resolved, "updates")[0].source, "Agent");
    power.dispose();
    power.initialize(context);
    assert.equal((await actions.get("notification.list").run({})).items[0].read, true);
  } finally { power.dispose(); await scope.files.dispose?.(); fs.rmSync(root, { recursive: true, force: true }); }
});

test("Inbox两个插槽共享查询，刷新保留选择并阻止旧快照回退已处理状态", async () => {
  const pending = (id) => ({ agent_id: "a", agent_name: "Agent", interaction: { can_respond: true,
    reference: { session_category: "work", session_id: "s", turn_id: "t", interaction_id: id },
    interaction: { status: "pending", request: { title: id, type: "question", payload: { questions: [] }, created_at: 1 } },
  } });
  const snapshot = { interactions: [pending("first"), pending("second")],
    items: [{ notification_id: "update", title: "完成", power_id: "notification", created_at: 2, read: false }], unavailable_agents: [], agent_names: { a: "程序员" } };
  let calls = 0;
  let resolve;
  const gateway = { invoke: async () => { calls++; return await new Promise((accept) => { resolve = accept; }); } };
  const store = new InboxStore();
  const release_sidebar = store.attach(gateway);
  const release_main = store.attach(gateway);
  try {
    assert.equal(calls, 1);
    resolve(structuredClone(snapshot));
    await store.refresh();
    const selected = inbox_entries(store.get_snapshot().data, "pending")[1];
    store.select(selected);
    store.dirty(selected.key);
    const refreshing = store.refresh();
    store.handled(selected);
    store.read("update");
    resolve(structuredClone(snapshot));
    await refreshing;
    assert.equal(store.get_snapshot().selected.pending.key, selected.key);
    assert.equal(store.get_snapshot().handled.has(selected.key), true);
    assert.equal(store.get_snapshot().data.interactions.length, 1);
    assert.equal(inbox_entries(store.get_snapshot().data, "pending")[0].source, "程序员");
    assert.equal(store.get_snapshot().data.items[0].read, true);
    assert.equal(store.get_snapshot().dirty_key, undefined);
    const removed_snapshot = { ...snapshot, interactions: [] };
    const refresh_removed = store.refresh(); resolve(removed_snapshot); await refresh_removed;
    assert.equal(store.get_snapshot().selected.pending.key, selected.key);
    release_sidebar();
    const still_active = store.refresh(); resolve(snapshot); await still_active;
    release_main();
    const final_calls = calls;
    await store.refresh();
    assert.equal(calls, final_calls);
  } finally { release_sidebar(); release_main(); }
});

test("Inbox贯通真实Agent提问、原地回答和Work完成更新", async () => {
  const notification = new NotificationPower();
  let calls = 0;
  const city = new City({ powers: [notification], workspaces: [new Workspace({ id: "project", path: process.cwd() })] });
  const agent = city.agents.add(new Agent({ id: "inbox-agent", tools: { ask_question: AskQuestionsTool }, model: new MockModelClient({ id: "inbox-model", generate: async (call) => {
    if (!call.tools?.length) return { text: "Inbox work" };
    if (++calls === 1) return { content: [{ type: "tool_call", tool_name: "ask_question", tool_call_id: "ask", input: { title: "Audience", questions: [{ question: "Who is the audience?", type: "text" }] } }] };
    return { text: "Report for engineers" };
  } }) }));
  try {
    await city.powers.settled();
    let changed;
    const requested = new Promise((resolve) => { changed = resolve; });
    const unsubscribe = agent.interactions.subscribe((event) => { if (event.type === "updated" && event.item.interaction.status === "pending") changed(); });
    const session = await agent.sessions.create({ origin: { category: "work", type: "work" } });
    session.dispose_title_generation();
    const turn = await session.prompt({ query: "Write a report" });
    await requested;
    const pending = await city.powers.invoke("notification", "notification.list", {});
    assert.equal(pending.interactions.length, 1);
    const item = pending.interactions[0];
    await city.powers.invoke("notification", "notification.respond", {
      agent_id: item.agent_id, reference: item.interaction.reference,
      response: { type: "question", outcome: "resolved", payload: { answers: [{ question_id: item.interaction.interaction.request.payload.questions[0].question_id, value: "engineers" }] } },
    });
    assert.equal((await turn.finished).success, true);
    await agent.resolve_completions().settle();
    const completed = await city.powers.invoke("notification", "notification.list", {});
    assert.equal(completed.interactions.length, 0);
    assert.equal(completed.items.length, 1);
    assert.equal(completed.items[0].body, "Report for engineers");
    assert.equal(completed.items[0].read, false);
    unsubscribe();
  } finally { await city.close(); }
});

test("Task Host mutation 明确返回定义已提交但 scheduler 同步失败", async () => {
  const { power, actions, cleanup } = await start_task_power();
  try {
    await power.scheduler.dispose();
    const result = await actions.get("tasks.create").run({
      agent_id: "task-agent",
      workspace_id: "workspace-a",
      title: "scheduler-failed-task",
      when: "@manual",
      kind: "agent",
      review: false,
      schedule: "enabled",
      body: "输出结果",
    });
    assert.equal(result.task_title, "scheduler-failed-task");
    assert.equal(result.scheduler.reloaded, false);
    assert.match(result.scheduler.error, /disposed/u);
    assert.equal(
      (await actions.get("tasks.snapshot").run()).tasks
        .some((task) => task.title === "scheduler-failed-task"),
      true,
    );
  } finally {
    await cleanup();
  }
});
