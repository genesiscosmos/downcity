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
    abort_signal: new AbortController().signal,
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

    // 聊天文件入口按发现根核对 ID/path；home 来源无需先关联，项目来源必须属于登记 Workspace。
    const home_read = await actions.get("skill.read").run({ agent_id: "test-agent", skill_id: "home-demo", expected_path: path.join(home_skill_path, "SKILL.md") });
    assert.equal(home_read.success, true);
    assert.match(home_read.content, /# Home Demo/u);
    const project_skill_path = path.join(workspace_path, ".agents", "skills", "project-demo", "SKILL.md");
    fs.mkdirSync(path.dirname(project_skill_path), { recursive: true });
    fs.writeFileSync(project_skill_path, "---\nname: Project Demo\ndescription: Project example\n---\n\n# Project Demo\n");
    const project_read = await actions.get("skill.read").run({ agent_id: "test-agent", skill_id: "project-demo", workspace_id: "test", expected_path: project_skill_path });
    assert.equal(project_read.success, true);
    assert.match(project_read.content, /# Project Demo/u);
    const unregistered_read = await actions.get("skill.read").run({ agent_id: "test-agent", skill_id: "project-demo", workspace_id: "unknown", expected_path: project_skill_path });
    assert.equal(unregistered_read.success, false);
    const mismatched_read = await actions.get("skill.read").run({ agent_id: "test-agent", skill_id: "home-demo", expected_path: project_skill_path });
    assert.equal(mismatched_read.success, false);
    const outside_path = path.join(base_path, "private.txt");
    fs.writeFileSync(outside_path, "not a Skill");
    const outside_read = await actions.get("skill.read").run({ agent_id: "test-agent", skill_id: "home-demo", expected_path: outside_path });
    assert.equal(outside_read.success, false);
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
  let pending = [{ origin: { category: "work", type: "task" }, reference: { session_category: "work", session_id: "s", turn_id: "t", interaction_id: "i" },
    can_respond: true, interaction: { status: "pending", request: { title: "Question", created_at: 1 } } }];
  const storage_id = "00000000-0000-4000-8000-000000000001";
  const target = { kind: "agent_session", storage_id, agent_id: "a", category: "work", session_id: "s", origin_type: "work" };
  let offline = false;
  let group_removed = false;
  let session_archived = false;
  let session_title = "Inbox 标题检查";
  let responded;
  const context = {
    storage: { path: scope.root_path, files: scope.files },
    power: { action: (action) => actions.set(action.id, action) },
    logger: { warn() {} },
    system: {
      register_notification_receiver: (value) => { receiver = value; return () => { receiver = undefined; }; },
      list_agents: async () => [{ agent_id: "a", name: "Agent" }],
      resolve_notification_targets: async (references) => references.map(reference => ({
        target: reference.kind === "agent_session" ? { ...reference, storage_id } : reference,
        title: reference.kind === "agent_session" ? session_title : reference.kind === "group_session" ? "群聊标题检查" : undefined,
        availability: reference.kind === "power" ? "available" : reference.kind === "group_session" && group_removed ? "removed"
          : reference.kind === "agent_session" && offline ? "unknown" : reference.kind === "agent_session" && session_archived ? "archived" : "available",
      })),
      list_agent_interactions: async () => { if (offline) throw new Error("offline"); return pending; },
      respond_agent_interaction: async (input) => { responded = input; pending = []; return { status: "resolved" }; },
    },
  };
  try {
    await power.initialize(context);
    assert.deepEqual(Object.keys(power.actions), []);
    const source = { source_kind: "power", power_id: "task", agent_id: "a" };
    const input = { topic_key: "task:one", kind: "update", scope: "inbox", outcome: "success", title: "Done", body: "result" };
    await receiver.publish(source, input);
    const first = await actions.get("notification.list").run({});
    assert.equal(first.items.length, 1);
    assert.equal(first.interactions.length, 1);
    assert.equal(first.badge_count, 1);
    assert.equal(first.pending_request_count, 1);
    assert.equal(first.unread_update_count, 1);
    assert.equal(first.unread_failure_count, 0);
    assert.equal(first.notifications.length, 2);
    assert.equal(first.interactions[0].target.origin_type, "task");
    assert.equal(first.interactions[0].session_title, session_title);
    assert.equal(first.notifications.find((item) => item.kind === "request").title, session_title);
    assert.equal(inbox_entries(first, "pending")[0].title, session_title);
    assert.equal(first.interactions[0].interaction.interaction.request.title, "Question");
    assert.equal(first.items[0].title, "Done"); // Task 标题不被 Session 投影替换。
    const saved_path = path.join(scope.root_path, "notifications.json");
    const before_query = fs.readFileSync(saved_path, "utf8");
    const query_mtime = fs.statSync(saved_path).mtimeMs;
    await actions.get("notification.list").run({});
    assert.equal(fs.readFileSync(saved_path, "utf8"), before_query);
    assert.equal(fs.statSync(saved_path).mtimeMs, query_mtime);
    pending = [{ ...pending[0], origin: undefined }];
    receiver.interactions_changed();
    const unidentified = await actions.get("notification.list").run({});
    assert.equal(unidentified.interactions.length, 1);
    assert.equal(unidentified.interactions[0].availability, "unknown");
    assert.equal(unidentified.interactions[0].target, undefined);
    assert.equal(unidentified.badge_count, 1);
    await actions.get("notification.view").run({ view_id: "window", target, visible: true });
    assert.equal((await actions.get("notification.list").run({})).interactions.length, 1);
    await actions.get("notification.read").run({ notification_id: first.items[0].notification_id, created_at: first.items[0].created_at });
    await receiver.publish(source, input);
    const read = await actions.get("notification.list").run({});
    assert.equal(read.items.length, 1);
    assert.equal(read.items[0].read, true);
    assert.equal(read.interactions.length, 1);
    assert.equal(read.badge_count, 1);
    assert.equal(read.unread_update_count, 0);
    offline = true;
    receiver.sources_changed();
    const unknown = await actions.get("notification.list").run({});
    assert.deepEqual(unknown.unavailable_agents, ["a"]);
    assert.equal(unknown.badge_count, 0);
    assert.equal(unknown.interactions.length, 1);
    offline = false;
    await actions.get("notification.refresh").run({});
    const recovered = await actions.get("notification.list").run({});
    assert.deepEqual(recovered.unavailable_agents, []);
    assert.ok(recovered.revision > unknown.revision);
    const request = { agent_id: "a", reference: pending[0].reference, response: { type: "question", outcome: "resolved", payload: { answers: [] } } };
    await actions.get("notification.respond").run(request);
    assert.deepEqual(responded, request);
    const resolved = await actions.get("notification.list").run({});
    assert.equal(resolved.interactions.length, 0);
    assert.equal(resolved.agent_names.a, "Agent");
    assert.equal(inbox_entries(resolved, "updates")[0].source, "Agent");
    power.dispose();
    await power.initialize(context);
    assert.equal((await actions.get("notification.list").run({})).items[0].read, true);
    await receiver.publish(source, { ...input, body: "changed", outcome: "failure", event_id: "run-2" });
    const changed = await actions.get("notification.list").run({});
    assert.equal(changed.badge_count, 1);
    assert.equal(changed.unread_failure_count, 1);
    assert.equal(changed.items[0].notification_id, first.items[0].notification_id);
    assert.equal(changed.items[0].outcome, "failure");
    assert.equal(changed.items[0].title, "Done");
    await actions.get("notification.read").run({ notification_id: first.items[0].notification_id, created_at: first.items[0].created_at });
    assert.equal((await actions.get("notification.list").run({})).badge_count, 1);
    await receiver.dismiss(source, { topic_key: input.topic_key });
    assert.equal((await actions.get("notification.list").run({})).items.length, 0);
    const commit = async (origin, id = "done") => await power.hooks.effect["session.turn_committed"][0]({
      context: { agent: { id: "a" }, snapshot: { session_origin: origin } },
      value: { storage_id, completion_id: id, session_id: "s", status: "completed", result: { text: "Result" } },
    });
    for (const type of ["task", "memory", "channel", "group"]) await commit({ category: "work", type });
    await commit({ category: "work", type: "work", delegation_depth: 2 });
    assert.equal((await actions.get("notification.list").run({})).items.length, 0);
    await commit({ category: "work", type: "work", delegation_depth: 1 });
    await commit({ category: "work", type: "work", delegation_depth: 1 });
    assert.equal((await actions.get("notification.list").run({})).unread_update_count, 1);
    await power.observe_view("window", target);
    assert.equal((await actions.get("notification.list").run({})).unread_update_count, 0);
    await power.observe_view("window");
    await commit({ category: "work", type: "work", delegation_depth: 1 }, "another-turn-same-result");
    const renewed = await actions.get("notification.list").run({});
    assert.equal(renewed.items.length, 1);
    assert.equal(renewed.unread_update_count, 1);
    assert.equal(renewed.badge_count, 0);
    assert.equal(renewed.items[0].title, session_title);
    assert.equal(renewed.items[0].body, "Result");
    const before_rename = fs.readFileSync(saved_path, "utf8");
    session_title = "重命名后的会话";
    receiver.sources_changed();
    const renamed = await actions.get("notification.list").run({});
    assert.equal(renamed.items[0].title, session_title);
    assert.equal(renamed.items[0].created_at, renewed.items[0].created_at);
    assert.equal(renamed.items[0].read, renewed.items[0].read);
    assert.equal(fs.readFileSync(saved_path, "utf8"), before_rename);
    session_title = " ";
    receiver.sources_changed();
    assert.equal((await actions.get("notification.list").run({})).items[0].title, "未命名会话");
    session_title = "重命名后的会话";
    receiver.sources_changed();
    await power.observe_view("window", target);
    const chat_target = { ...target, category: "chat", origin_type: "agent" };
    receiver.sources_changed();
    await commit({ category: "chat", type: "agent" }, "agent-complete");
    const chat_reply = await actions.get("notification.list").run({});
    assert.equal(chat_reply.items.length, 2);
    assert.equal(chat_reply.badge_count, 0);
    assert.equal(chat_reply.unread_update_count, 0);
    assert.equal(inbox_entries(chat_reply, "updates").length, 1);
    assert.equal(chat_reply.notifications[0].scope, "session");
    await commit({ category: "chat", type: "agent" }, "next-turn");
    assert.equal((await actions.get("notification.list").run({})).items.length, 2);
    await power.observe_view("window", chat_target);
    const failure = { type: "group_event", group_id: "g", session_id: "gs", event: { type: "status", phase: "failed", turn_id: "gt", members: [] } };
    await receiver.fact_changed(failure);
    await receiver.fact_changed(failure);
    assert.equal((await actions.get("notification.list").run({})).items.find((item) => item.source_kind === "group").title, "群聊标题检查");
    assert.equal((await actions.get("notification.list").run({})).badge_count, 1);
    await receiver.fact_changed({ ...failure, event: { ...failure.event, phase: "idle" } });
    assert.equal((await actions.get("notification.list").run({})).badge_count, 1);
    group_removed = true; receiver.sources_changed();
    const removed_group = await actions.get("notification.list").run({});
    assert.equal(removed_group.badge_count, 1);
    assert.equal(removed_group.items.find((item) => item.source_kind === "group").availability, "removed");
    session_archived = true; receiver.sources_changed();
    const archived = await actions.get("notification.list").run({});
    assert.equal(archived.items.find((item) => item.target.kind === "agent_session" && item.target.category === "work").availability, "archived");
    const archived_bytes = fs.readFileSync(saved_path, "utf8");
    await actions.get("notification.list").run({});
    assert.equal(fs.readFileSync(saved_path, "utf8"), archived_bytes);
    receiver.sources_changed();
    assert.equal((await actions.get("notification.list").run({})).items.length, 3);

    // 用户操作只针对点击时的普通 Inbox 更新版本；恶意传入 Interaction 或 session 也无效。
    session_archived = false;
    pending = ["question", "approval", "private"].map((type) => ({
      origin: { category: "work", type: "work" }, can_respond: true,
      reference: { session_category: "work", session_id: "s", turn_id: "t", interaction_id: type },
      interaction: { status: "pending", request: { type, title: type, created_at: 1 } },
    }));
    receiver.interactions_changed();
    await power.observe_view("window");
    await commit({ category: "chat", type: "agent" }, "unread-session-reply");
    await receiver.publish(source, { ...input, event_id: "run-3" });
    await receiver.publish(source, { ...input, topic_key: "info", outcome: "info", event_id: "info-1" });
    const visible = await actions.get("notification.list").run({});
    assert.equal(visible.pending_request_count, 3);
    assert.equal(visible.unread_update_count, 3);
    assert.equal(visible.unread_failure_count, 1);
    assert.equal(visible.badge_count, 4);
    const references = visible.items.map(({ notification_id, created_at }) => ({ notification_id, created_at }));
    const request_references = visible.notifications.filter((item) => item.kind === "request")
      .map(({ notification_id, created_at }) => ({ notification_id, created_at }));
    const task_version = visible.items.find((item) => item.topic_key === input.topic_key);
    await receiver.publish(source, { ...input, outcome: "failure", event_id: "run-4" });
    await receiver.publish(source, { ...input, topic_key: "late", event_id: "late-1" });
    const read_result = await actions.get("notification.read_updates").run({ updates: [...references, ...request_references] });
    assert.equal(read_result.snapshot.unread_update_count, 2);
    assert.equal(read_result.snapshot.unread_failure_count, 1);
    assert.equal(read_result.snapshot.badge_count, 4);
    assert.equal(read_result.snapshot.items.find((item) => item.scope === "session").read, false);
    await actions.get("notification.clear_update").run({ notification_id: task_version.notification_id, created_at: task_version.created_at });
    await actions.get("notification.clear_read_updates").run({ updates: [...references, ...request_references] });
    const remaining = await actions.get("notification.list").run({});
    assert.equal(remaining.items.length, 3); // session 回复、新 Task 版本、点击后出现的事项。
    assert.equal(remaining.interactions.length, 3);
    assert.deepEqual(pending.map((item) => item.interaction.status), ["pending", "pending", "pending"]);
    assert.deepEqual(responded, request);
    const current_task = remaining.items.find((item) => item.topic_key === input.topic_key);
    const current_reference = { notification_id: current_task.notification_id, created_at: current_task.created_at };
    await actions.get("notification.clear_read_updates").run({ updates: [current_reference] });
    assert.equal((await actions.get("notification.list").run({})).items.length, 3); // 仍未读，不能被清除已读吞掉。
    await actions.get("notification.read_updates").run({ updates: [current_reference] });
    await receiver.publish(source, { ...input, outcome: "failure", event_id: "run-5" });
    await actions.get("notification.clear_read_updates").run({ updates: [current_reference] });
    const next_task = (await actions.get("notification.list").run({})).items.find((item) => item.topic_key === input.topic_key);
    assert.equal(next_task.read, false);
    const next_reference = { notification_id: next_task.notification_id, created_at: next_task.created_at };
    await actions.get("notification.clear_update").run(next_reference);
    assert.equal((await actions.get("notification.list").run({})).items.length, 2);
    const original_now = Date.now;
    try {
      Date.now = () => next_task.created_at; // 清除后同一毫秒重发仍不能复用旧版本。
      await receiver.publish(source, { ...input, outcome: "failure", event_id: "run-6" });
    } finally { Date.now = original_now; }
    await actions.get("notification.clear_update").run(next_reference);
    const reappeared = await actions.get("notification.list").run({});
    assert.equal(reappeared.items.length, 3);
    assert.ok(reappeared.items.find((item) => item.topic_key === input.topic_key).created_at > next_task.created_at);
    assert.equal(reappeared.pending_request_count, 3);
    assert.equal(reappeared.unread_failure_count, 1);
    // 单条清除 session 和原 Interaction 引用同样无效。
    for (const update of [references.find((item) => item.notification_id === chat_reply.items.find((item) => item.scope === "session").notification_id), ...request_references]) {
      await actions.get("notification.clear_update").run(update);
    }
    assert.equal((await actions.get("notification.list").run({})).items.length, 3);
  } finally { power.dispose(); await scope.files.dispose?.(); fs.rmSync(root, { recursive: true, force: true }); }
});

test("Inbox两个插槽共享查询，刷新保留选择并阻止旧快照回退已处理状态", async () => {
  const pending = (id) => ({ agent_id: "a", agent_name: "Agent", interaction: { can_respond: true,
    reference: { session_category: "work", session_id: "s", turn_id: "t", interaction_id: id },
    interaction: { status: "pending", request: { title: id, type: "question", payload: { questions: [] }, created_at: 1 } },
  } });
  const snapshot = { revision: 1, pending_request_count: 2, unread_update_count: 1, unread_failure_count: 0, badge_count: 2,
    interactions: [pending("first"), pending("second")], notifications: [],
    items: [{ notification_id: "update", title: "完成", scope: "inbox", power_id: "notification", created_at: 2, read: false }],
    unavailable_agents: [], unavailable_groups: [], agent_names: { a: "程序员" } };
  const read_snapshot = { ...snapshot, revision: 2, pending_request_count: 1, unread_update_count: 0, badge_count: 1,
    interactions: [pending("first")], items: [{ ...snapshot.items[0], read: true }] };
  let calls = 0;
  let resolve;
  let resolve_action;
  let fail_action = false;
  const invoked = [];
  const gateway = { invoke: async (action, input) => {
    invoked.push({ action, input });
    if (action !== "notification.list") {
      if (fail_action) throw new Error("write failed");
      return await new Promise((accept) => { resolve_action = accept; });
    }
    calls++;
    return await new Promise((accept) => { resolve = accept; });
  } };
  const store = new InboxStore();
  const release_sidebar = store.attach(gateway);
  const release_main = store.attach(gateway);
  try {
    assert.equal(calls, 1);
    resolve(structuredClone(snapshot));
    await new Promise((accept) => setImmediate(accept));
    const selected = inbox_entries(store.get_snapshot().data, "pending")[1];
    store.select(selected);
    store.dirty(selected.key);
    const refreshing = store.refresh();
    store.handled(selected);
    const reading = store.mark_read("update", 2);
    resolve_action({ snapshot: read_snapshot });
    await reading;
    resolve(structuredClone(snapshot));
    await refreshing;
    assert.equal(store.get_snapshot().selected.key, selected.key);
    assert.equal(store.get_snapshot().handled.has(selected.key), true);
    assert.equal(store.get_snapshot().data.interactions.length, 1);
    assert.equal(inbox_entries(store.get_snapshot().data, "pending")[0].source, "程序员");
    assert.equal(store.get_snapshot().data.items[0].read, true);
    assert.equal(store.get_snapshot().dirty_key, undefined);
    assert.equal(store.get_snapshot().data.badge_count, 1);
    assert.equal(store.get_snapshot().data.unread_update_count, 0);
    const clearing = store.update_notifications("clear_read");
    assert.ok(store.get_snapshot().update_action);
    const action_count = invoked.length;
    await store.update_notifications("clear_read");
    assert.equal(invoked.length, action_count);
    assert.equal(store.get_snapshot().selected.key, selected.key);
    assert.deepEqual(invoked.at(-1), { action: "notification.clear_read_updates", input: { updates: [{ notification_id: "update", created_at: 2 }] } });
    const cleared_snapshot = { ...read_snapshot, revision: 3, items: [] };
    resolve_action({ snapshot: cleared_snapshot });
    await clearing;
    assert.equal(store.get_snapshot().update_action, undefined);
    assert.equal(store.get_snapshot().data.items.length, 0);
    fail_action = true;
    await store.update_notifications("clear", { key: "old", update: snapshot.items[0] });
    assert.equal(store.get_snapshot().update_error, "write failed");
    assert.equal(store.get_snapshot().data, cleared_snapshot);
    const removed_snapshot = { ...cleared_snapshot, revision: 4, interactions: [] };
    const refresh_removed = store.refresh(); resolve(removed_snapshot); await refresh_removed;
    assert.equal(store.get_snapshot().selected.key, selected.key);
    release_sidebar();
    const still_active = store.refresh(); resolve(snapshot); await still_active;
    release_main();
    const final_calls = calls;
    await store.refresh();
    assert.equal(calls, final_calls);
  } finally { release_sidebar(); release_main(); }
});

test("Inbox贯通真实Agent提问、原地回答和Work完成更新", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "downcity-notification-lifecycle-"));
  const notification = new NotificationPower();
  let calls = 0;
  const city = new City({ storage: new LocalStorageProvider(root), powers: [notification], workspaces: [new Workspace({ id: "project", path: process.cwd() })] });
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
    await session.rename("工程师报告");
    const turn = await session.prompt({ query: "Write a report" });
    await requested;
    const pending = await city.powers.invoke("notification", "notification.list", {});
    assert.equal(pending.interactions.length, 1);
    const item = pending.interactions[0];
    assert.equal(item.interaction.origin.type, "work");
    assert.equal(item.target.origin_type, "work");
    assert.equal(item.session_title, "工程师报告");
    assert.equal(inbox_entries(pending, "pending")[0].title, "工程师报告");
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
    assert.equal(completed.items[0].outcome, "success");
    assert.equal(completed.items[0].title, "工程师报告");
    await session.rename("报告审核");
    // 目录变化异步交给 Notification；等待该版本而非启动新执行。
    for (let attempt = 0; attempt < 100; attempt++) {
      const snapshot = await city.powers.invoke("notification", "notification.list", {});
      if (snapshot.items[0]?.title === "报告审核") break;
      await new Promise((resolve) => setImmediate(resolve));
    }
    const renamed = await city.powers.invoke("notification", "notification.list", {});
    assert.equal(renamed.items[0].title, "报告审核");
    assert.equal(renamed.items[0].created_at, completed.items[0].created_at);
    assert.equal(renamed.items[0].read, false);
    await agent.sessions.archive({ id: session.id, category: "work" });
    const archived = await city.powers.invoke("notification", "notification.list", {});
    assert.equal(archived.items.length, 1);
    assert.equal(archived.items[0].availability, "archived");
    assert.equal(archived.items[0].body, "Report for engineers");
    assert.equal(archived.unread_update_count, 1);
    assert.equal(archived.badge_count, 0);
    unsubscribe();
    await city.close();
    const saved = JSON.parse(fs.readFileSync(path.join(root, "powers", "notification", "notifications.json"), "utf8"));
    assert.equal(saved.length, 1);
    assert.equal(saved[0].read, false);
  } finally { await city.close(); fs.rmSync(root, { recursive: true, force: true }); }
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
