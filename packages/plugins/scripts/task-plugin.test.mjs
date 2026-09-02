/**
 * Task Plugin 真实 Session 与 scheduler 回归测试。
 *
 * 关键点（中文）
 * - 使用 City 持久化存储，覆盖 Desktop 相同的 Workspace Session 恢复条件。
 * - 手动触发 scheduler 注册的 one-shot 回调，避免测试依赖真实分钟边界。
 * - 最终结果必须作为 assistant 消息写入关联 Session，并发布 mutation。
 */

import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { Agent, City, create_action } from "@downcity/agent";
import { create_workspace_entry } from "@downcity/agent/internal";
import { LocalStorageProvider, Workspace } from "../../workspace/bin/index.js";
import { MockModelClient } from "../../agent/scripts/ModelClientMock.mjs";
import { TaskPlugin } from "../bin/task.js";
import { createTaskDefinition } from "../bin/task/Action.js";
import { registerTaskCronJobs } from "../bin/task/Scheduler.js";

test("scheduler 只注册当前 Workspace 绑定的 Task", async () => {
  const data_path = await fs.mkdtemp(path.join(os.tmpdir(), "downcity-task-workspace-filter-"));
  try {
    await createTaskDefinition({ data_path, request: { title: "workspace-a-task", description: "A", workspace_id: "workspace-a", when: "0 9 * * *", status: "enabled" } });
    await createTaskDefinition({ data_path, request: { title: "workspace-b-task", description: "B", workspace_id: "workspace-b", when: "0 10 * * *", status: "enabled" } });
    const definitions = [];
    const result = await registerTaskCronJobs({
      context: {
        data_path,
        workspace_id: "workspace-a",
        logger: { log: async () => {}, debug() {}, info() {}, warn() {}, error() {} },
      },
      engine: { register: (definition) => definitions.push(definition) },
      timezone: "Asia/Shanghai",
      runningTaskIds: new Set(),
    });

    assert.deepEqual(result, { tasksFound: 1, jobsScheduled: 1 });
    assert.deepEqual(definitions.map((definition) => definition.id), ["task:workspace-a-task"]);
  } finally {
    await fs.rm(data_path, { recursive: true, force: true });
  }
});

test("scheduled task appends its result to the linked Workspace Session", async () => {
  const root_path = await fs.mkdtemp(path.join(os.tmpdir(), "downcity-task-scheduler-"));
  const workspace = new Workspace({
    id: "task-scheduler-workspace",
    path: root_path,
    data_root_path: path.join(root_path, "workspace-data"),
  });
  const city = new City({
    storage: new LocalStorageProvider(path.join(root_path, "city-data")),
    workspaces: [workspace],
  });
  const published_notifications = [];
  const notifications = {
    publish: async (input) => { published_notifications.push(input); },
    dismiss: async () => {},
  };
  const task_plugin = new TaskPlugin({ notifications });
  const scheduled_definitions = [];
  task_plugin.actions.test_trigger_scheduler = create_action({
    description: "测试专用：注册并触发当前 Task scheduler。",
    execute: async ({ context }) => {
      await registerTaskCronJobs({
        context,
        notifications,
        engine: {
          register: (definition) => scheduled_definitions.push(definition),
        },
        timezone: "Asia/Shanghai",
        runningTaskIds: new Set(),
      });
      const definition = scheduled_definitions.find((item) =>
        item.id === "task-time:scheduled-session-result"
      );
      assert.ok(definition, "one-shot scheduler definition should be registered");
      await definition.execute();
      return { success: true };
    },
  });
  const agent = new Agent({
    id: "task-scheduler-agent",
    model: new MockModelClient({
      generate: async () => ({ text: "SCHEDULED_TASK_RESULT" }),
    }),
    plugins: [task_plugin],
  });
  city.agents.add(agent);
  const entry = create_workspace_entry(agent, workspace);

  try {
    const linked_session = await entry.sessions.create();
    const mutations = [];
    const unsubscribe = linked_session.subscribe((mutation) => {
      mutations.push(mutation);
    });
    const created = await entry.plugins.run_action({
      plugin: "task",
      action: "create",
      payload: {
        title: "scheduled-session-result",
        description: "验证 scheduler 结果写回关联 Session",
        when: `time:${new Date(Date.now() - 1_000).toISOString()}`,
        session_id: linked_session.id,
        kind: "agent",
        status: "enabled",
        body: "直接输出 SCHEDULED_TASK_RESULT。",
      },
    });
    assert.equal(created.success, true);

    const triggered = await entry.plugins.run_action({
      plugin: "task",
      action: "test_trigger_scheduler",
      payload: {},
    });
    unsubscribe();
    assert.equal(triggered.success, true);

    const history = await entry.plugins.run_action({
      plugin: "task",
      action: "history",
      payload: { title: "scheduled-session-result" },
    });
    assert.equal(history.success, true);
    assert.equal(history.data.runs.length, 1);
    assert.equal(history.data.runs[0].status, "success");
    assert.equal(history.data.runs[0].trigger, "time");

    const run_detail = await entry.plugins.run_action({
      plugin: "task",
      action: "run_detail",
      payload: {
        title: "scheduled-session-result",
        timestamp: history.data.runs[0].timestamp,
      },
    });
    assert.equal(run_detail.success, true);
    assert.equal(run_detail.data.run.output, "SCHEDULED_TASK_RESULT");
    assert.equal(run_detail.data.run.error_detail, "");
    assert.deepEqual(published_notifications, [{
      topic_key: "task:scheduled-session-result",
      title: "scheduled-session-result 已完成",
      route: {
        agent_id: "task-scheduler-agent",
        task_title: "scheduled-session-result",
        view: "run",
        run_timestamp: history.data.runs[0].timestamp,
      },
    }]);

    const messages = await linked_session.messages();
    const final_message = messages.items.at(-1);
    assert.equal(final_message?.type, "assistant");
    assert.equal(final_message?.parts.at(-1)?.type, "text");
    assert.equal(final_message?.parts.at(-1)?.text, "SCHEDULED_TASK_RESULT");
    assert.equal(
      mutations.some((mutation) =>
        mutation.variant === "message" && mutation.type === "assistant"
      ),
      true,
    );
  } finally {
    await city.close();
    await fs.rm(root_path, { recursive: true, force: true });
  }
});
