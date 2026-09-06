/** Plugin 单实例宿主 actions 与凭据边界测试。 */

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { ChatPlugin } from "@downcity/plugins/chat";
import { SkillPlugin } from "@downcity/plugins/skill";
import { TaskPlugin } from "@downcity/plugins/task";
import { createTaskDefinition } from "../bin/task/Action.js";
import { TaskDefinitionRepository } from "../bin/task/runtime/TaskDefinitionRepository.js";
import { TaskExecutionCoordinator } from "../bin/task/runtime/TaskExecutionCoordinator.js";
import { LocalStorageProvider } from "@downcity/city";

/** 启动 Chat Plugin 并返回按 ID 注册的配置 action。 */
async function start_chat_plugin() {
  const actions = new Map();
  await new ChatPlugin().initialize({
    plugin: {
      id: "chat",
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
      async invoke_agent_plugin() { return {}; },
      async append_agent_session_assistant_message() {},
      async open_external() {},
      async show_item_in_folder() {},
      async write_clipboard_text() {},
    },
  });
  return actions;
}

/** 启动 Skill Plugin，并注入测试 Workspace。 */
async function start_skill_plugin(workspace_path) {
  const actions = new Map();
  await new SkillPlugin().initialize({
    plugin: {
      id: "skill",
      action(action) { actions.set(action.id, action); },
      config_action() {},
    },
    logger: {
      debug() {},
      info() {},
      warn() {},
      error() {},
    },
    system: {
      async list_agents() { return []; },
      async list_workspaces() {
        return [{ workspace_id: "test", name: "Test", workspace_path }];
      },
      async invoke_agent_plugin() { return {}; },
      async append_agent_session_assistant_message() {},
      async open_external() {},
      async show_item_in_folder() {},
      async write_clipboard_text() {},
    },
  });
  return actions;
}

/** 启动 Task Plugin，并记录对 Agent Plugin runtime 的调用。 */
async function start_task_plugin(options = {}) {
  const actions = new Map();
  const invocations = [];
  const data_path = fs.mkdtempSync(path.join(os.tmpdir(), "downcity-task-host-actions-"));
  const task_scope = new LocalStorageProvider(data_path).open_scope(["plugins", "task"]);
  const storage = { path: task_scope.root_path, files: task_scope.files };
  const definitions_repository = new TaskDefinitionRepository(
    storage,
    new TaskExecutionCoordinator(),
  );
  await createTaskDefinition({
    definitions: definitions_repository,
    agent_id: "task-agent",
    request: {
      title: "daily-report",
      description: "生成日报",
      body: "汇总今天的进展",
      when: "@manual",
      status: "enabled",
      kind: "agent",
      review: false,
      workspace_id: "workspace-b",
    },
    delivery_session: {
      agent_id: "task-agent",
      workspace_id: "workspace-b",
      session_id: "daily-report",
      origin_type: "chat",
    },
  });
  const run_path = path.join(storage.path, "tasks", "daily-report", "20260901-080000-000");
  fs.mkdirSync(run_path, { recursive: true });
  fs.writeFileSync(path.join(run_path, "output.md"), "# Task Output\n日报正文\n");
  fs.writeFileSync(path.join(run_path, "run.json"), JSON.stringify({
    v: 1,
    taskId: "daily-report",
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
  const plugin = new TaskPlugin();
  await plugin.initialize({
    plugin: {
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
          { agent_id: "task-agent", name: "Task Agent", plugin_ids: ["task", "skill"] },
          { agent_id: "empty-task-agent", name: "Empty Task Agent", plugin_ids: ["task"] },
          { agent_id: "chat-agent", name: "Chat Agent", plugin_ids: ["chat"] },
        ];
      },
      async list_workspaces() {
        return options.workspaces || [
          { workspace_id: "workspace-a", name: "Workspace A", workspace_path: "/workspace-a" },
          { workspace_id: "workspace-b", name: "Workspace B", workspace_path: "/workspace-b" },
        ];
      },
      async invoke_agent_plugin(input) {
        invocations.push(input);
        return { success: true, data: { accepted: true } };
      },
      async append_agent_session_assistant_message() {},
      async open_external() {},
      async show_item_in_folder() {},
      async write_clipboard_text() {},
    },
  });
  return {
    actions,
    invocations,
    cleanup: async () => {
      await plugin.dispose();
      fs.rmSync(data_path, { recursive: true, force: true });
    },
  };
}

/** 创建可观察完整替换结果的 Profile 配置上下文。 */
function create_config_context(initial_config) {
  let config = structuredClone(initial_config);
  return {
    context: {
      config: {
        async get() {
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

test("Chat Plugin 读取 Profile 时不泄漏 Channel 凭据", async () => {
  const actions = await start_chat_plugin();
  const store = create_config_context({
    channels: [
      { id: "telegram_main", type: "telegram", name: "Main", bot_token: "telegram-secret" },
      { id: "feishu_main", type: "feishu", name: "Work", app_id: "cli_a", app_secret: "feishu-secret" },
    ],
  });

  const profile = await actions.get("profile.read").run(undefined, store.context);

  assert.equal(JSON.stringify(profile).includes("telegram-secret"), false);
  assert.equal(JSON.stringify(profile).includes("feishu-secret"), false);
  assert.deepEqual(profile.channels.map((channel) => channel.secret_configured), [true, true]);
});

test("Chat Plugin 保存时为空的凭据输入会保留已有凭据", async () => {
  const actions = await start_chat_plugin();
  const store = create_config_context({
    channels: [
      { id: "telegram_main", type: "telegram", name: "Old", bot_token: "kept-secret" },
    ],
  });

  const result = await actions.get("profile.save").run({
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

test("Chat Plugin 拒绝没有凭据的新 Channel", async () => {
  const actions = await start_chat_plugin();
  const store = create_config_context({ channels: [] });

  await assert.rejects(
    () => actions.get("profile.save").run({
      queue: {},
      channels: [{ id: "telegram_new", type: "telegram", name: "New" }],
    }, store.context),
    /Telegram Bot Token is required/u,
  );
});

test("Skill Plugin 不需要 Profile 即可浏览和读取 Workspace Skill", async () => {
  const workspace_path = fs.mkdtempSync(path.join(os.tmpdir(), "downcity-skill-main-"));
  const skill_path = path.join(workspace_path, ".agents", "skills", "demo");
  fs.mkdirSync(skill_path, { recursive: true });
  fs.writeFileSync(path.join(skill_path, "SKILL.md"), "---\nname: Demo\ndescription: Example\n---\n\n# Demo\n");
  try {
    const actions = await start_skill_plugin(workspace_path);
    const snapshot = await actions.get("skills.list").run();
    assert.deepEqual(snapshot.workspaces[0].skills.map((skill) => skill.id), ["demo"]);

    const result = await actions.get("skills.read").run({
      scope: "workspace",
      workspace_id: "test",
      skill_id: "demo",
    });
    assert.equal(result.success, true);
    assert.match(result.content, /# Demo/u);
  } finally {
    fs.rmSync(workspace_path, { recursive: true, force: true });
  }
});

test("Task Plugin 返回统一 Task 列表和可选执行目标", async () => {
  const { actions, invocations, cleanup } = await start_task_plugin();
  try {
    const snapshot = await actions.get("tasks.snapshot").run();
    assert.deepEqual(snapshot.tasks, [{
      title: "daily-report",
      description: "生成日报",
      body: "汇总今天的进展",
      when: "@manual",
      status: "enabled",
      kind: "agent",
      review: false,
      agent_id: "task-agent",
      workspace_id: "workspace-b",
      delivery_session: {
        agent_id: "task-agent",
        workspace_id: "workspace-b",
        session_id: "daily-report",
        origin_type: "chat",
      },
      last_run_at: "20260901-080000-000",
    }]);
    assert.deepEqual(snapshot.agents, [
      { agent_id: "task-agent", name: "Task Agent" },
      { agent_id: "empty-task-agent", name: "Empty Task Agent" },
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

test("Task Plugin 使用 Task 自身 Workspace 完成管理操作", async () => {
  const { actions, invocations, cleanup } = await start_task_plugin({
    dismiss_notification: async () => {
      throw new Error("notification unavailable");
    },
  });
  try {
    await actions.get("tasks.create").run({
    agent_id: "task-agent",
    workspace_id: "workspace-b",
    title: "weekly-review",
    description: "生成周报",
    when: "@manual",
    kind: "agent",
    review: true,
    status: "paused",
    body: "汇总本周进展",
  });
  await actions.get("tasks.update").run({
    agent_id: "empty-task-agent",
    workspace_id: "workspace-a",
    current_title: "weekly-review",
    title: "weekly-review",
    description: "更新周报",
    when: "0 18 * * 5",
    kind: "agent",
    review: false,
    status: "enabled",
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

test("Task Plugin 直接从统一 Store 读取执行记录与详情", async () => {
  const { actions, invocations, cleanup } = await start_task_plugin();
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

test("Task Plugin 保留目标失效的 Task 并允许宿主删除", async () => {
  const { actions, cleanup } = await start_task_plugin({
    agents: [{ agent_id: "another-agent", name: "Another Agent", plugin_ids: ["task"] }],
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
