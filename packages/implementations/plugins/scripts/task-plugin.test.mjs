/**
 * Task Plugin 统一存储与生命周期 scheduler 回归测试。
 *
 * 覆盖 Task 定义的 City 级唯一事实源、Agent 投影隔离，以及 Plugin initialize
 * 在没有 Session/system 调用时恢复已有 schedule。
 */

import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { Agent } from "@downcity/agent";
import { City, LocalStorageProvider, MemoryStorageProvider, Workspace } from "@downcity/city";
import { MockModelClient } from "../../../agent/scripts/ModelClientMock.mjs";
import { TaskPlugin } from "../bin/task.js";
import {
  createTaskDefinition,
  deleteTaskDefinition,
  list_task_run_history,
  updateTaskDefinition,
} from "../bin/task/Action.js";
import { TaskSchedulerCoordinator } from "../bin/task/Scheduler.js";
import { TaskDefinitionRepository } from "../bin/task/runtime/TaskDefinitionRepository.js";
import { TaskExecutionCoordinator } from "../bin/task/runtime/TaskExecutionCoordinator.js";
import { inspect_task_definitions, listTasks, readTask } from "../bin/task/runtime/Store.js";

/** 把测试实例包装为 City 持有的统一 Plugin 注册。 */
function create_task_registration(plugin) {
  return {
    id: "task",
    title: "Task",
    description: "Task test plugin",
    readme: import.meta.filename,
    has_config: false,
    has_sidebar: false,
    has_mainview: false,
    plugin,
  };
}

/** 从 City Storage scope 创建 Task Store 使用的 PluginStorage。 */
function create_plugin_storage(provider) {
  const scope = provider.open_scope(["plugins", "task"]);
  return { path: scope.root_path, files: scope.files };
}

/** 创建不会访问文件端口的最小生命周期上下文。 */
function create_lifecycle_context(storage, invocations) {
  return {
    plugin: { id: "task", action() {}, config_action() {} },
    storage,
    logger: { log: async () => {}, debug() {}, info() {}, warn() {}, error() {} },
    notifications: { publish: async () => {}, dismiss: async () => {} },
    system: {
      list_agents: async () => [],
      list_workspaces: async () => [],
      invoke_agent_plugin: async (input) => {
        invocations.push(input);
        return { success: true, data: { accepted: true } };
      },
      append_agent_session_assistant_message: async () => {},
      open_external: async () => {},
      show_item_in_folder: async () => {},
      write_clipboard_text: async () => {},
    },
  };
}

/** 等待异步条件成立，并在超时后给出稳定失败。 */
async function wait_until(predicate, timeout_ms = 6_000) {
  const deadline = Date.now() + timeout_ms;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`condition did not become true within ${timeout_ms} ms`);
}

test("scheduler 从统一 Store 注册全部 Agent/Workspace 的 Task", async () => {
  const data_path = await fs.mkdtemp(path.join(os.tmpdir(), "downcity-task-coordinator-"));
  const storage = create_plugin_storage(new LocalStorageProvider(data_path));
  const definitions_repository = new TaskDefinitionRepository(
    storage,
    new TaskExecutionCoordinator(),
  );
  const definitions = new Map();
  const invocations = [];
  const lifecycle_events = [];
  const engine = {
    register: (definition) => {
      lifecycle_events.push(`register:${definition.id}`);
      definitions.set(definition.id, definition);
    },
    unregister: (id) => definitions.delete(id),
    start: async () => lifecycle_events.push("start"),
    stop: async () => definitions.clear(),
  };
  try {
    await createTaskDefinition({
      definitions: definitions_repository,
      agent_id: "agent-a",
      request: {
        title: "workspace-a-task",
        description: "A",
        workspace_id: "workspace-a",
        when: "0 9 * * *",
        status: "enabled",
      },
    });
    await createTaskDefinition({
      definitions: definitions_repository,
      agent_id: "agent-b",
      request: {
        title: "workspace-b-task",
        description: "B",
        workspace_id: "workspace-b",
        when: "0 10 * * *",
        status: "enabled",
      },
    });

    const scheduler = new TaskSchedulerCoordinator(
      create_lifecycle_context(storage, invocations),
      "Asia/Shanghai",
      definitions_repository,
      engine,
    );
    assert.deepEqual(await scheduler.initialize(), {
      tasks_found: 2,
      jobs_scheduled: 2,
      tasks_invalid: 0,
    });
    assert.deepEqual([...definitions.keys()].sort(), [
      "task:workspace-a-task",
      "task:workspace-b-task",
    ]);
    assert.deepEqual(lifecycle_events, [
      "register:task:workspace-a-task",
      "register:task:workspace-b-task",
      "start",
    ]);

    await definitions.get("task:workspace-b-task").execute();
    assert.deepEqual(invocations, [{
      agent_id: "agent-b",
      workspace_id: "workspace-b",
      plugin_id: "task",
      action_id: "run",
      input: { title: "workspace-b-task", scheduler_trigger: "cron" },
    }]);
    await scheduler.dispose();
  } finally {
    await fs.rm(data_path, { recursive: true, force: true });
  }
});

test("scheduler dispose 会等待已进入的触发回调", async () => {
  const storage = create_plugin_storage(new MemoryStorageProvider());
  const definitions_repository = new TaskDefinitionRepository(
    storage,
    new TaskExecutionCoordinator(),
  );
  const definitions = new Map();
  let mark_invocation_started;
  const invocation_started = new Promise((resolve) => {
    mark_invocation_started = resolve;
  });
  let release_invocation;
  const invocation_released = new Promise((resolve) => {
    release_invocation = resolve;
  });
  const context = create_lifecycle_context(storage, []);
  context.system.invoke_agent_plugin = async () => {
    mark_invocation_started();
    await invocation_released;
    return { success: true, data: { accepted: true } };
  };
  await createTaskDefinition({
    definitions: definitions_repository,
    agent_id: "agent-a",
    request: {
      title: "dispose-waits-trigger",
      description: "验证 scheduler 触发回调的关闭边界",
      workspace_id: "workspace-a",
      when: "0 9 * * *",
      status: "enabled",
    },
  });
  const scheduler = new TaskSchedulerCoordinator(context, "Asia/Shanghai", definitions_repository, {
    register: (definition) => definitions.set(definition.id, definition),
    unregister: (id) => definitions.delete(id),
    start: async () => {},
    stop: async () => {},
  });
  await scheduler.initialize();

  const triggering = definitions.get("task:dispose-waits-trigger").execute();
  await invocation_started;
  let disposed = false;
  const disposing = scheduler.dispose().then(() => {
    disposed = true;
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(disposed, false);

  release_invocation();
  await Promise.all([triggering, disposing]);
  assert.equal(disposed, true);
});

test("scheduler dispose 会在配置变更收口后停止 engine", async () => {
  const storage = create_plugin_storage(new MemoryStorageProvider());
  const definitions_repository = new TaskDefinitionRepository(
    storage,
    new TaskExecutionCoordinator(),
  );
  const lifecycle_events = [];
  let release_operation;
  const operation_released = new Promise((resolve) => {
    release_operation = resolve;
  });
  const scheduler = new TaskSchedulerCoordinator(
    create_lifecycle_context(storage, []),
    "Asia/Shanghai",
    definitions_repository,
    {
      register: () => {},
      unregister: () => {},
      start: async () => {},
      stop: async () => { lifecycle_events.push("stop"); },
    },
  );
  scheduler.operation_chain = operation_released.then(() => {
    lifecycle_events.push("operation");
  });

  const disposing = scheduler.dispose();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(lifecycle_events, []);

  release_operation();
  await disposing;
  assert.deepEqual(lifecycle_events, ["operation", "stop"]);
});

test("scheduler stop 失败时仍等待已进入的触发并聚合错误", async () => {
  const storage = create_plugin_storage(new MemoryStorageProvider());
  const definitions_repository = new TaskDefinitionRepository(
    storage,
    new TaskExecutionCoordinator(),
  );
  let mark_invocation_started;
  const invocation_started = new Promise((resolve) => {
    mark_invocation_started = resolve;
  });
  let release_invocation;
  const invocation_released = new Promise((resolve) => {
    release_invocation = resolve;
  });
  const context = create_lifecycle_context(storage, []);
  context.system.invoke_agent_plugin = async () => {
    mark_invocation_started();
    await invocation_released;
    return { success: true, data: { accepted: true } };
  };
  await createTaskDefinition({
    definitions: definitions_repository,
    agent_id: "agent-a",
    request: {
      title: "dispose-error",
      description: "验证失败释放",
      workspace_id: "workspace-a",
      when: "0 9 * * *",
      status: "enabled",
    },
  });
  const registered = new Map();
  const scheduler = new TaskSchedulerCoordinator(
    context,
    "Asia/Shanghai",
    definitions_repository,
    {
      register: (definition) => registered.set(definition.id, definition),
      unregister: (id) => registered.delete(id),
      start: async () => {},
      stop: async () => { throw new Error("engine stop failed"); },
    },
  );
  await scheduler.initialize();
  const triggering = registered.get("task:dispose-error").execute();
  await invocation_started;
  let disposal_finished = false;
  const disposing = scheduler.dispose()
    .then(() => undefined)
    .catch((error) => error)
    .finally(() => { disposal_finished = true; });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(disposal_finished, false);

  release_invocation();
  const error = await disposing;
  await triggering;
  assert.equal(error instanceof AggregateError, true);
  assert.match(String(error.errors[0]), /engine stop failed/u);
});

test("TaskPlugin scheduler 释放失败时仍等待运行并清空生命周期引用", async () => {
  const plugin = new TaskPlugin();
  let release_execution;
  const execution_released = new Promise((resolve) => {
    release_execution = resolve;
  });
  plugin.scheduler = {
    dispose: async () => { throw new Error("scheduler dispose failed"); },
  };
  plugin.lifecycle_context = { marker: true };
  plugin.definitions = { marker: true };
  assert.equal(
    plugin.executions.start("dispose-running-task", async () => await execution_released),
    true,
  );
  let disposal_finished = false;
  const disposing = plugin.dispose()
    .then(() => undefined)
    .catch((error) => error)
    .finally(() => { disposal_finished = true; });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(disposal_finished, false);

  release_execution();
  const error = await disposing;
  assert.equal(error instanceof AggregateError, true);
  assert.match(String(error.errors[0]), /scheduler dispose failed/u);
  assert.equal(plugin.lifecycle_context, undefined);
  assert.equal(plugin.definitions, undefined);
});

test("损坏 Task 会明确报告，但不会阻止其他 Task 恢复调度", async () => {
  const data_path = await fs.mkdtemp(path.join(os.tmpdir(), "downcity-task-corrupt-"));
  const storage = create_plugin_storage(new LocalStorageProvider(data_path));
  const definitions_repository = new TaskDefinitionRepository(
    storage,
    new TaskExecutionCoordinator(),
  );
  try {
    await createTaskDefinition({
      definitions: definitions_repository,
      agent_id: "agent-a",
      request: {
        title: "healthy-definition",
        description: "验证有效定义仍会恢复",
        workspace_id: "workspace-a",
        when: "0 9 * * *",
        status: "enabled",
      },
    });
    const missing_directory = path.join(storage.path, "tasks", "missing-definition");
    await fs.mkdir(missing_directory, { recursive: true });
    await assert.rejects(
      () => listTasks(storage),
      /Task definition cannot be read: missing-definition/u,
    );

    await fs.writeFile(path.join(missing_directory, "task.md"), "not valid task markdown");
    await assert.rejects(
      () => listTasks(storage),
      /Task definition is invalid: missing-definition/u,
    );

    const inspection = await inspect_task_definitions(storage);
    assert.deepEqual(inspection.tasks.map((task) => task.taskId), ["healthy-definition"]);
    assert.equal(inspection.issues.length, 1);
    assert.equal(inspection.issues[0].task_id, "missing-definition");

    const registered = new Map();
    const scheduler = new TaskSchedulerCoordinator(
      create_lifecycle_context(storage, []),
      "Asia/Shanghai",
      definitions_repository,
      {
        register: (definition) => registered.set(definition.id, definition),
        unregister: (id) => registered.delete(id),
        start: async () => {},
        stop: async () => registered.clear(),
      },
    );
    assert.deepEqual(await scheduler.initialize(), {
      tasks_found: 1,
      jobs_scheduled: 1,
      tasks_invalid: 1,
    });
    assert.deepEqual([...registered.keys()], ["task:healthy-definition"]);
    await scheduler.dispose();
  } finally {
    await fs.rm(data_path, { recursive: true, force: true });
  }
});

test("并发创建相同标题时只有第一个定义可以提交", async () => {
  const storage = create_plugin_storage(new MemoryStorageProvider());
  const definitions_repository = new TaskDefinitionRepository(
    storage,
    new TaskExecutionCoordinator(),
  );
  const [first, second] = await Promise.all([
    createTaskDefinition({
      definitions: definitions_repository,
      agent_id: "agent-a",
      request: {
        title: "same-title",
        description: "first",
        workspace_id: "workspace-a",
        when: "@manual",
      },
    }),
    createTaskDefinition({
      definitions: definitions_repository,
      agent_id: "agent-b",
      request: {
        title: "same-title",
        description: "second",
        workspace_id: "workspace-b",
        when: "@manual",
      },
    }),
  ]);

  assert.equal(first.success, true);
  assert.equal(second.success, false);
  assert.match(second.error, /another Agent/u);
  assert.equal((await readTask({ storage, taskId: "same-title" })).frontmatter.agent_id, "agent-a");
});

test("运行中的 Task 聚合目录不能被删除", async () => {
  const storage = create_plugin_storage(new MemoryStorageProvider());
  const executions = new TaskExecutionCoordinator();
  const definitions_repository = new TaskDefinitionRepository(storage, executions);
  await createTaskDefinition({
    definitions: definitions_repository,
    agent_id: "agent-a",
    request: {
      title: "running-task",
      description: "running",
      workspace_id: "workspace-a",
      when: "@manual",
    },
  });
  let release_execution;
  const execution_released = new Promise((resolve) => {
    release_execution = resolve;
  });
  assert.equal(executions.start("running-task", async () => await execution_released), true);

  const blocked = await deleteTaskDefinition({
    definitions: definitions_repository,
    request: { title: "running-task" },
  });
  assert.equal(blocked.success, false);
  assert.match(blocked.error, /is running and cannot be deleted/u);

  release_execution();
  await executions.settle();
  const deleted = await deleteTaskDefinition({
    definitions: definitions_repository,
    request: { title: "running-task" },
  });
  assert.equal(deleted.success, true);
});

test("one-shot 完成时保留触发期间提交的最新定义", async () => {
  const storage = create_plugin_storage(new MemoryStorageProvider());
  const definitions_repository = new TaskDefinitionRepository(
    storage,
    new TaskExecutionCoordinator(),
  );
  const planned_time = new Date(Date.now() + 30).toISOString();
  const when = `time:${planned_time}`;
  await createTaskDefinition({
    definitions: definitions_repository,
    agent_id: "agent-a",
    request: {
      title: "one-shot-latest",
      description: "before",
      body: "before body",
      workspace_id: "workspace-a",
      when,
      status: "enabled",
    },
  });
  const registered = new Map();
  const context = create_lifecycle_context(storage, []);
  context.system.invoke_agent_plugin = async () => {
    const updated = await updateTaskDefinition({
      definitions: definitions_repository,
      request: {
        title: "one-shot-latest",
        description: "after",
        body: "after body",
      },
    });
    assert.equal(updated.success, true);
    return { success: true, data: { accepted: true } };
  };
  const scheduler = new TaskSchedulerCoordinator(
    context,
    "Asia/Shanghai",
    definitions_repository,
    {
      register: (definition) => registered.set(definition.id, definition),
      unregister: (id) => registered.delete(id),
      start: async () => {},
      stop: async () => {},
    },
  );
  await scheduler.initialize();
  await new Promise((resolve) => setTimeout(resolve, 40));
  await registered.get("task-time:one-shot-latest").execute();

  const current = await readTask({ storage, taskId: "one-shot-latest" });
  assert.equal(current.frontmatter.description, "after");
  assert.equal(current.body, "after body");
  assert.equal(current.frontmatter.when, "@manual");
  assert.equal(current.frontmatter.status, "paused");
  await scheduler.dispose();
});

test("TaskPlugin initialize 无需 Session 调用即可恢复已有 schedule", async () => {
  const root_path = await fs.mkdtemp(path.join(os.tmpdir(), "downcity-task-recovery-"));
  const city_data_path = path.join(root_path, "city-data");
  const storage_provider = new LocalStorageProvider(city_data_path);
  const task_storage = create_plugin_storage(storage_provider);
  const definitions_repository = new TaskDefinitionRepository(
    task_storage,
    new TaskExecutionCoordinator(),
  );
  const workspace = new Workspace({
    id: "recovery-workspace",
    path: root_path,
    data_root_path: path.join(root_path, "workspace-data"),
  });
  const agent = new Agent({
    id: "recovery-agent",
    model: new MockModelClient({
      generate: async () => ({ text: "RECOVERED_TASK_RESULT" }),
    }),
  });
  await createTaskDefinition({
    definitions: definitions_repository,
    agent_id: agent.id,
    request: {
      title: "restart-task",
      description: "验证 Plugin 初始化恢复 schedule",
      workspace_id: workspace.id,
      when: "* * * * * *",
      kind: "agent",
      status: "enabled",
      body: "直接输出 RECOVERED_TASK_RESULT。",
    },
  });

  const city = new City({
    storage: storage_provider,
    workspaces: [workspace],
    agents: [agent],
  });
  try {
    await city.plugins.add(create_task_registration(new TaskPlugin()));
    await wait_until(async () => {
      const history = await list_task_run_history({
        storage: task_storage,
        request: { title: "restart-task" },
      });
      return Boolean(history.success && history.runs?.some((run) => run.status === "success"));
    });

    const history = await list_task_run_history({
      storage: task_storage,
      request: { title: "restart-task" },
    });
    assert.equal(history.success, true);
    assert.equal(history.runs?.[0]?.trigger, "cron");
    assert.equal(
      await fs.stat(path.join(task_storage.path, "tasks", "restart-task", "task.md")).then(() => true),
      true,
    );
    assert.equal(
      await fs.stat(path.join(city_data_path, "agents", agent.id, "plugins", "task", "tasks"))
        .then(() => true)
        .catch(() => false),
      false,
    );
  } finally {
    await city.close();
    await fs.rm(root_path, { recursive: true, force: true });
  }
});

test("统一 Store 仍按 Task 的 agent_id 向 Agent 投影", async () => {
  const root_path = await fs.mkdtemp(path.join(os.tmpdir(), "downcity-task-agent-view-"));
  const workspace = new Workspace({ id: "shared-workspace", path: root_path });
  const model = new MockModelClient({ generate: async () => ({ text: "ok" }) });
  const agent_a = new Agent({ id: "agent-a", model });
  const agent_b = new Agent({ id: "agent-b", model });
  const city = new City({
    storage: new LocalStorageProvider(path.join(root_path, "city-data")),
    workspaces: [workspace],
    agents: [agent_a, agent_b],
  });
  try {
    await city.plugins.add(create_task_registration(new TaskPlugin()));
    await Promise.all([
      city.enter_workspace(agent_a.id, workspace.id),
      city.enter_workspace(agent_b.id, workspace.id),
    ]);
    const scope_a = city.plugins.scope({ agent_id: agent_a.id, workspace_id: workspace.id });
    const scope_b = city.plugins.scope({ agent_id: agent_b.id, workspace_id: workspace.id });
    const created = await scope_a.run_action({
      plugin: "task",
      action: "create",
      payload: {
        title: "agent-a-task",
        description: "只属于 Agent A 的执行定义",
        when: "@manual",
      },
    });
    assert.equal(created.success, true);
    const [list_a, list_b] = await Promise.all([
      scope_a.run_action({ plugin: "task", action: "list", payload: {} }),
      scope_b.run_action({ plugin: "task", action: "list", payload: {} }),
    ]);
    assert.deepEqual(list_a.data.tasks.map((task) => task.agent_id), [agent_a.id]);
    assert.deepEqual(list_b.data.tasks, []);
  } finally {
    await city.close();
    await fs.rm(root_path, { recursive: true, force: true });
  }
});

test("Task 定义通过 Storage 文件端口支持 City 默认内存存储", async () => {
  const root_path = await fs.mkdtemp(path.join(os.tmpdir(), "downcity-task-memory-store-"));
  const workspace = new Workspace({ id: "memory-workspace", path: root_path });
  const agent = new Agent({
    id: "memory-agent",
    model: new MockModelClient({ generate: async () => ({ text: "ok" }) }),
  });
  const city = new City({
    storage: new MemoryStorageProvider(),
    workspaces: [workspace],
    agents: [agent],
  });
  try {
    await city.plugins.add(create_task_registration(new TaskPlugin()));
    await city.enter_workspace(agent.id, workspace.id);
    const scope = city.plugins.scope({ agent_id: agent.id, workspace_id: workspace.id });
    const created = await scope.run_action({
      plugin: "task",
      action: "create",
      payload: {
        title: "memory-task",
        description: "验证内存 Storage",
        when: "@manual",
      },
    });
    assert.equal(created.success, true);
    const listed = await scope.run_action({ plugin: "task", action: "list", payload: {} });
    assert.deepEqual(listed.data.tasks.map((task) => ({
      title: task.title,
      agent_id: task.agent_id,
      workspace_id: task.workspace_id,
    })), [{
      title: "memory-task",
      agent_id: agent.id,
      workspace_id: workspace.id,
    }]);
  } finally {
    await city.close();
    await fs.rm(root_path, { recursive: true, force: true });
  }
});

test("Task 重新绑定执行 Agent 后仍向原始 Agent Session 交付结果", async () => {
  const root_path = await fs.mkdtemp(path.join(os.tmpdir(), "downcity-task-delivery-agent-"));
  const storage_provider = new LocalStorageProvider(path.join(root_path, "city-data"));
  const task_storage = create_plugin_storage(storage_provider);
  const workspace = new Workspace({ id: "shared-workspace", path: root_path });
  const agent_a = new Agent({
    id: "delivery-agent",
    model: new MockModelClient({ generate: async () => ({ text: "unused" }) }),
  });
  const agent_b = new Agent({
    id: "execution-agent",
    model: new MockModelClient({ generate: async () => ({ text: "CROSS_AGENT_RESULT" }) }),
  });
  const city = new City({
    storage: storage_provider,
    workspaces: [workspace],
    agents: [agent_a, agent_b],
  });
  try {
    const delivery_entry = await city.enter_workspace(agent_a.id, workspace.id);
    const delivery_session = await delivery_entry.sessions.create();
    const definitions_repository = new TaskDefinitionRepository(
      task_storage,
      new TaskExecutionCoordinator(),
    );
    await createTaskDefinition({
      definitions: definitions_repository,
      agent_id: agent_a.id,
      request: {
        title: "cross-agent-delivery",
        description: "由另一个 Agent 执行并交付到原始 Session",
        workspace_id: workspace.id,
        when: "@manual",
        body: "直接输出 CROSS_AGENT_RESULT。",
      },
      delivery_session: {
        agent_id: agent_a.id,
        workspace_id: workspace.id,
        session_id: delivery_session.id,
        origin_type: delivery_session.origin.type,
      },
    });
    await city.plugins.add(create_task_registration(new TaskPlugin()));
    await city.plugins.invoke("task", "tasks.update", {
      agent_id: agent_b.id,
      workspace_id: workspace.id,
      current_title: "cross-agent-delivery",
      title: "cross-agent-delivery",
      description: "由另一个 Agent 执行并交付到原始 Session",
      when: "@manual",
      kind: "agent",
      review: false,
      status: "enabled",
      body: "直接输出 CROSS_AGENT_RESULT。",
    });
    await city.enter_workspace(agent_b.id, workspace.id);
    const scope = city.plugins.scope({ agent_id: agent_b.id, workspace_id: workspace.id });
    const result = await scope.run_action({
      plugin: "task",
      action: "run",
      payload: { title: "cross-agent-delivery" },
    });
    assert.equal(result.data.accepted, true);
    await wait_until(async () => JSON.stringify(await delivery_session.messages())
      .includes("CROSS_AGENT_RESULT"));
  } finally {
    await city.close();
    await fs.rm(root_path, { recursive: true, force: true });
  }
});

test("City close 会停止 Task Session 并等待后台执行收口", async () => {
  const root_path = await fs.mkdtemp(path.join(os.tmpdir(), "downcity-task-close-"));
  let mark_model_started;
  const model_started = new Promise((resolve) => {
    mark_model_started = resolve;
  });
  const model = {
    id: "blocking-task-model",
    async stream(_call, abort_signal) {
      return new ReadableStream({
        start(controller) {
          controller.enqueue({
            type: "model_start",
            request_id: "blocking-task-request",
            model_id: "blocking-task-model",
          });
          mark_model_started();
          abort_signal.addEventListener("abort", () => {
            controller.error(abort_signal.reason || new Error("stopped"));
          }, { once: true });
        },
      });
    },
  };
  const workspace = new Workspace({ id: "close-workspace", path: root_path });
  const agent = new Agent({ id: "close-agent", model });
  const city = new City({
    storage: new MemoryStorageProvider(),
    workspaces: [workspace],
    agents: [agent],
  });

  try {
    await city.plugins.add(create_task_registration(new TaskPlugin()));
    await city.enter_workspace(agent.id, workspace.id);
    const scope = city.plugins.scope({ agent_id: agent.id, workspace_id: workspace.id });
    await scope.run_action({
      plugin: "task",
      action: "create",
      payload: {
        title: "close-running-task",
        description: "验证 City 关闭时的后台 Task 收口",
        when: "@manual",
        body: "等待关闭。",
      },
    });
    const run_result = await scope.run_action({
      plugin: "task",
      action: "run",
      payload: { title: "close-running-task" },
    });
    assert.equal(run_result.data.accepted, true);
    await model_started;
    await Promise.race([
      city.close(),
      new Promise((_, reject) => {
        setTimeout(() => reject(new Error("City close timed out")), 2_000).unref();
      }),
    ]);
  } finally {
    await city.close();
    await fs.rm(root_path, { recursive: true, force: true });
  }
});
