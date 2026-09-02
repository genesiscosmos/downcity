/** Plugin main 的 Config action 与凭据边界测试。 */

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { CHAT_PLUGIN_MAIN } from "../bin/chat/main/ChatPluginMain.js";
import { SKILL_PLUGIN_MAIN } from "../bin/skill/main/SkillPluginMain.js";
import { TASK_PLUGIN_MAIN } from "../bin/task/main/TaskPluginMain.js";

/** 激活 main 并返回按 ID 注册的 action。 */
async function activate_chat_main() {
  const actions = new Map();
  await CHAT_PLUGIN_MAIN.activate({
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
      async open_external() {},
      async show_item_in_folder() {},
      async write_clipboard_text() {},
    },
  });
  return actions;
}

/** 激活 Skill main，并注入测试 Workspace。 */
async function activate_skill_main(workspace_path) {
  const actions = new Map();
  await SKILL_PLUGIN_MAIN.activate({
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
      async open_external() {},
      async show_item_in_folder() {},
      async write_clipboard_text() {},
    },
  });
  return actions;
}

/** 激活 Task main，并记录对 Agent Plugin runtime 的调用。 */
async function activate_task_main() {
  const actions = new Map();
  const invocations = [];
  await TASK_PLUGIN_MAIN.activate({
    plugin: {
      id: "task",
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
      async list_agents() {
        return [
          { agent_id: "task-agent", name: "Task Agent", plugin_ids: ["task", "skill"] },
          { agent_id: "empty-task-agent", name: "Empty Task Agent", plugin_ids: ["task"] },
          { agent_id: "chat-agent", name: "Chat Agent", plugin_ids: ["chat"] },
        ];
      },
      async list_workspaces() {
        return [
          { workspace_id: "workspace-a", name: "Workspace A", workspace_path: "/workspace-a" },
          { workspace_id: "workspace-b", name: "Workspace B", workspace_path: "/workspace-b" },
        ];
      },
      async invoke_agent_plugin(input) {
        invocations.push(input);
        if (input.action_id === "history") {
          return {
            success: true,
            data: {
              runs: [{
                timestamp: "20260901-080000-000",
                execution_id: "daily-report:1",
                status: "success",
                trigger: "manual",
                started_at: 1_788_246_000_000,
                updated_at: 1_788_246_001_000,
                ended_at: 1_788_246_001_000,
                duration_ms: 1000,
              }],
            },
          };
        }
        if (input.action_id === "run_detail") {
          return {
            success: true,
            data: {
              run: {
                timestamp: "20260901-080000-000",
                execution_id: "daily-report:1",
                status: "success",
                trigger: "manual",
                started_at: 1_788_246_000_000,
                updated_at: 1_788_246_001_000,
                ended_at: 1_788_246_001_000,
                duration_ms: 1000,
                output: "日报正文",
                error_detail: "",
                result_errors: [],
              },
            },
          };
        }
        return {
          success: true,
          data: {
            tasks: input.agent_id === "task-agent" ? [{
              title: "daily-report",
              description: "生成日报",
              body: "汇总今天的进展",
              when: "0 18 * * *",
              status: "enabled",
              kind: "agent",
              review: false,
              workspace_id: "workspace-b",
              session_id: "daily-report",
              lastRunTimestamp: "2026-08-31T10:00:00.000Z",
            }] : [],
          },
        };
      },
      async open_external() {},
      async show_item_in_folder() {},
      async write_clipboard_text() {},
    },
  });
  return { actions, invocations };
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

test("Chat main 读取 Profile 时不泄漏 Channel 凭据", async () => {
  const actions = await activate_chat_main();
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

test("Chat main 保存时为空的凭据输入会保留已有凭据", async () => {
  const actions = await activate_chat_main();
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

test("Chat main 拒绝没有凭据的新 Channel", async () => {
  const actions = await activate_chat_main();
  const store = create_config_context({ channels: [] });

  await assert.rejects(
    () => actions.get("profile.save").run({
      queue: {},
      channels: [{ id: "telegram_new", type: "telegram", name: "New" }],
    }, store.context),
    /Telegram Bot Token is required/u,
  );
});

test("Skill main 不需要 Profile 即可浏览和读取 Workspace Skill", async () => {
  const workspace_path = fs.mkdtempSync(path.join(os.tmpdir(), "downcity-skill-main-"));
  const skill_path = path.join(workspace_path, ".agents", "skills", "demo");
  fs.mkdirSync(skill_path, { recursive: true });
  fs.writeFileSync(path.join(skill_path, "SKILL.md"), "---\nname: Demo\ndescription: Example\n---\n\n# Demo\n");
  try {
    const actions = await activate_skill_main(workspace_path);
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

test("Task main 按 Agent 聚合所有启用 Task Plugin 的任务", async () => {
  const { actions, invocations } = await activate_task_main();

  const snapshot = await actions.get("tasks.snapshot").run();

  assert.deepEqual(snapshot.agents, [{
    agent_id: "task-agent",
    name: "Task Agent",
    tasks: [{
      title: "daily-report",
      description: "生成日报",
      body: "汇总今天的进展",
      when: "0 18 * * *",
      status: "enabled",
      kind: "agent",
      review: false,
      workspace_id: "workspace-b",
      session_id: "daily-report",
      last_run_at: "2026-08-31T10:00:00.000Z",
    }],
  }, {
    agent_id: "empty-task-agent",
    name: "Empty Task Agent",
    tasks: [],
  }]);
  assert.deepEqual(snapshot.workspaces, [
    { workspace_id: "workspace-a", name: "Workspace A" },
    { workspace_id: "workspace-b", name: "Workspace B" },
  ]);
  assert.deepEqual(invocations, [{
    agent_id: "task-agent",
    workspace_id: "workspace-a",
    plugin_id: "task",
    action_id: "list",
    input: {},
  }, {
    agent_id: "empty-task-agent",
    workspace_id: "workspace-a",
    plugin_id: "task",
    action_id: "list",
    input: {},
  }]);
});

test("Task main 使用 Task 自身 Workspace 完成管理操作", async () => {
  const { actions, invocations } = await activate_task_main();

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
    agent_id: "task-agent",
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
  await actions.get("tasks.status").run({ agent_id: "task-agent", workspace_id: "workspace-a", task_title: "weekly-review", status: "paused" });
  await actions.get("tasks.run").run({ agent_id: "task-agent", workspace_id: "workspace-a", task_title: "weekly-review" });
  await actions.get("tasks.delete").run({ agent_id: "task-agent", workspace_id: "workspace-a", task_title: "weekly-review" });

  assert.deepEqual(invocations.map((invocation) => ({ workspace_id: invocation.workspace_id, action_id: invocation.action_id, input: invocation.input })), [
    { workspace_id: "workspace-b", action_id: "create", input: { title: "weekly-review", description: "生成周报", workspace_id: "workspace-b", when: "@manual", kind: "agent", review: true, status: "paused", body: "汇总本周进展" } },
    { workspace_id: "workspace-a", action_id: "update", input: { title: "weekly-review", titleNext: "weekly-review", description: "更新周报", workspace_id: "workspace-a", when: "0 18 * * 5", kind: "agent", review: false, status: "enabled", body: "输出更新后的周报" } },
    { workspace_id: "workspace-a", action_id: "status", input: { title: "weekly-review", status: "paused" } },
    { workspace_id: "workspace-a", action_id: "run", input: { title: "weekly-review" } },
    { workspace_id: "workspace-a", action_id: "delete", input: { title: "weekly-review" } },
  ]);
});

test("Task main 通过所选 Agent runtime 读取执行记录与详情", async () => {
  const { actions, invocations } = await activate_task_main();
  const context = {
    agent_id: "task-agent",
    workspace_id: "workspace-b",
    task_title: "daily-report",
  };

  const history = await actions.get("tasks.history").run(context);
  assert.equal(history.runs[0].status, "success");

  const detail = await actions.get("tasks.run_detail").run({
    ...context,
    timestamp: "20260901-080000-000",
  });
  assert.equal(detail.run.output, "日报正文");
  assert.deepEqual(invocations, [{
    agent_id: "task-agent",
    workspace_id: "workspace-b",
    plugin_id: "task",
    action_id: "history",
    input: { title: "daily-report" },
  }, {
    agent_id: "task-agent",
    workspace_id: "workspace-b",
    plugin_id: "task",
    action_id: "run_detail",
    input: { title: "daily-report", timestamp: "20260901-080000-000" },
  }]);
});
