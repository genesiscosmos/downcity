/**
 * Task Plugin 的宿主管理 actions。
 *
 * 只读与定义 mutation 直接访问 TaskPlugin 生命周期级统一 Store；只有真正执行 Task
 * 时才通过 City 进入定义声明的 Agent/Workspace 动态执行范围。
 */

import type { PluginJsonValue, PluginLifecycleContext } from "@downcity/city/plugin";
import {
  createTaskDefinition,
  deleteTaskDefinition,
  listTaskDefinitions,
  list_task_run_history,
  read_task_run,
  setTaskStatus,
  updateTaskDefinition,
} from "@/task/Action.js";
import { deriveTaskIdFromTitle } from "@/task/runtime/Paths.js";
import { readTask, resolveTaskIdByTitle } from "@/task/runtime/Store.js";
import type { TaskRunDetailView } from "@/task/types/TaskCommand.js";
import type {
  TaskMainviewActionInput,
  TaskMainviewCreateInput,
  TaskMainviewHistoryInput,
  TaskMainviewHistorySnapshot,
  TaskMainviewMutationResult,
  TaskMainviewRunDetailInput,
  TaskMainviewRunDetailSnapshot,
  TaskMainviewSnapshot,
  TaskMainviewStatusInput,
  TaskMainviewUpdateInput,
} from "@/task/types/TaskMainview.js";
import type { TaskPluginHostRuntime } from "@/task/types/TaskPluginTypes.js";

/** 注册 Task Plugin 的宿主管理 actions。 */
export function register_task_plugin_host_actions(
  context: PluginLifecycleContext,
  runtime: TaskPluginHostRuntime,
): void {
  context.plugin.action({ id: "tasks.snapshot", run: async () => as_json(await create_snapshot(context, runtime)) });
  context.plugin.action({ id: "tasks.history", run: async (input) => as_json(await read_history(runtime, read_history_input(input))) });
  context.plugin.action({ id: "tasks.run_detail", run: async (input) => as_json(await read_run_detail(runtime, read_run_detail_input(input))) });
  context.plugin.action({ id: "tasks.create", run: async (input) => as_json(await create_task(context, runtime, read_create_input(input))) });
  context.plugin.action({ id: "tasks.update", run: async (input) => as_json(await update_task(context, runtime, read_update_input(input))) });
  context.plugin.action({ id: "tasks.status", run: async (input) => as_json(await set_task_status(context, runtime, read_status_input(input))) });
  context.plugin.action({ id: "tasks.run", run: async (input) => as_json(await run_task(context, runtime, read_action_input(input))) });
  context.plugin.action({ id: "tasks.delete", run: async (input) => as_json(await delete_task(context, runtime, read_action_input(input))) });
}

/** 读取 TaskPlugin 统一 Task 列表与可选执行目标。 */
async function create_snapshot(
  context: PluginLifecycleContext,
  runtime: TaskPluginHostRuntime,
): Promise<TaskMainviewSnapshot> {
  const [agents, workspaces, task_result] = await Promise.all([
    context.system.list_agents(),
    context.system.list_workspaces(),
    listTaskDefinitions({ storage: runtime.storage }),
  ]);
  const task_agents = agents.filter((agent) => agent.plugin_ids.includes("task"));
  return {
    tasks: task_result.tasks.map((task) => ({
      title: task.title,
      description: task.description,
      ...(task.body ? { body: task.body } : {}),
      when: task.when,
      status: task.status,
      kind: task.kind || "agent",
      review: Boolean(task.review),
      agent_id: task.agent_id,
      workspace_id: task.workspace_id,
      ...(task.delivery_session ? { delivery_session: task.delivery_session } : {}),
      ...(task.lastRunTimestamp ? { last_run_at: task.lastRunTimestamp } : {}),
    })),
    agents: task_agents.map((agent) => ({
      agent_id: agent.agent_id,
      name: agent.name,
    })),
    workspaces: workspaces.map((workspace) => ({
      workspace_id: workspace.workspace_id,
      name: workspace.name,
    })),
  };
}

/** 直接从统一 Store 读取一个 Task 的执行记录列表。 */
async function read_history(
  runtime: TaskPluginHostRuntime,
  input: TaskMainviewHistoryInput,
): Promise<TaskMainviewHistorySnapshot> {
  await read_existing_task(runtime.storage, input.task_title);
  const result = await list_task_run_history({
    storage: runtime.storage,
    request: { title: input.task_title },
  });
  if (!result.success) throw new Error(result.error || `读取 ${input.task_title} 的执行记录失败`);
  return { runs: result.runs ?? [] };
}

/** 直接从统一 Store 读取一条 Task 执行详情。 */
async function read_run_detail(
  runtime: TaskPluginHostRuntime,
  input: TaskMainviewRunDetailInput,
): Promise<TaskMainviewRunDetailSnapshot> {
  await read_existing_task(runtime.storage, input.task_title);
  const result = await read_task_run({
    storage: runtime.storage,
    request: { title: input.task_title, timestamp: input.timestamp },
  });
  if (!result.success || !result.run) {
    throw new Error(result.error || `执行记录不存在: ${input.timestamp}`);
  }
  return { run: result.run as TaskRunDetailView };
}

/** 在统一 Store 创建一个显式绑定 Agent/Workspace 的 Task。 */
async function create_task(
  context: PluginLifecycleContext,
  runtime: TaskPluginHostRuntime,
  input: TaskMainviewCreateInput,
): Promise<TaskMainviewMutationResult> {
  await assert_execution_target(context, input.agent_id, input.workspace_id);
  const result = await createTaskDefinition({
    storage: runtime.storage,
    agent_id: input.agent_id,
    request: {
      title: input.title,
      description: input.description,
      workspace_id: input.workspace_id,
      when: input.when,
      kind: input.kind,
      review: input.review,
      status: input.status,
      body: input.body,
    },
  });
  if (!result.success) throw new Error(result.error || `创建 ${input.title} 失败`);
  await runtime.reconcile(deriveTaskIdFromTitle(input.title));
  return { task_title: input.title };
}

/** 原子更新一个 Task 定义，并按 task_id 更新 scheduler。 */
async function update_task(
  context: PluginLifecycleContext,
  runtime: TaskPluginHostRuntime,
  input: TaskMainviewUpdateInput,
): Promise<TaskMainviewMutationResult> {
  await assert_execution_target(context, input.agent_id, input.workspace_id);
  await read_existing_task(runtime.storage, input.current_title);
  const result = await updateTaskDefinition({
    storage: runtime.storage,
    request: {
      title: input.current_title,
      titleNext: input.title,
      description: input.description,
      agent_id: input.agent_id,
      workspace_id: input.workspace_id,
      when: input.when,
      kind: input.kind,
      review: input.review,
      status: input.status,
      body: input.body,
    },
  });
  if (!result.success) throw new Error(result.error || `更新 ${input.current_title} 失败`);
  await runtime.reconcile(deriveTaskIdFromTitle(input.current_title));
  return { task_title: input.title };
}

/** 修改 Task 启停状态。 */
async function set_task_status(
  context: PluginLifecycleContext,
  runtime: TaskPluginHostRuntime,
  input: TaskMainviewStatusInput,
): Promise<TaskMainviewMutationResult> {
  const task = await read_existing_task(runtime.storage, input.task_title);
  if (input.status === "enabled") {
    await assert_execution_target(
      context,
      task.frontmatter.agent_id,
      task.frontmatter.workspace_id,
    );
  }
  const result = await setTaskStatus({
    storage: runtime.storage,
    request: { title: input.task_title, status: input.status },
  });
  if (!result.success) throw new Error(result.error || `修改 ${input.task_title} 状态失败`);
  await runtime.reconcile(deriveTaskIdFromTitle(input.task_title));
  return { task_title: input.task_title };
}

/** 进入 Task 自己声明的执行范围，并异步受理一次手动执行。 */
async function run_task(
  context: PluginLifecycleContext,
  runtime: TaskPluginHostRuntime,
  input: TaskMainviewActionInput,
): Promise<TaskMainviewMutationResult> {
  const task = await read_existing_task(runtime.storage, input.task_title);
  await assert_execution_target(
    context,
    task.frontmatter.agent_id,
    task.frontmatter.workspace_id,
  );
  const result = await invoke_task_action(
    context,
    task.frontmatter.agent_id,
    task.frontmatter.workspace_id,
    "run",
    { title: input.task_title },
  );
  if (!result.success) throw new Error(result.error || `运行 ${input.task_title} 失败`);
  return { task_title: input.task_title };
}

/** 从统一 Store 删除 Task 定义及其全部运行记录。 */
async function delete_task(
  context: PluginLifecycleContext,
  runtime: TaskPluginHostRuntime,
  input: TaskMainviewActionInput,
): Promise<TaskMainviewMutationResult> {
  await read_existing_task(runtime.storage, input.task_title);
  const result = await deleteTaskDefinition({
    storage: runtime.storage,
    request: { title: input.task_title },
  });
  if (!result.success) throw new Error(result.error || `删除 ${input.task_title} 失败`);
  await runtime.reconcile(deriveTaskIdFromTitle(input.task_title));
  await dismiss_task_notification(context, input.task_title);
  return { task_title: input.task_title };
}

/** 删除 Task 后尽力清理未读通知，通知故障不改变已提交的定义变更。 */
async function dismiss_task_notification(
  context: PluginLifecycleContext,
  task_title: string,
): Promise<void> {
  try {
    await context.notifications.dismiss({
      topic_key: `task:${deriveTaskIdFromTitle(task_title)}`,
    });
  } catch (error) {
    context.logger.warn("[TASK] Task notification cleanup failed", {
      task_title,
      error: String(error),
    });
  }
}

/** 调用当前 City 中指定 Agent/Workspace 的 Task action。 */
async function invoke_task_action(
  context: PluginLifecycleContext,
  agent_id: string,
  workspace_id: string,
  action_id: string,
  action_input: PluginJsonValue,
): Promise<{ success?: boolean; error?: string }> {
  return await context.system.invoke_agent_plugin({
    agent_id,
    workspace_id,
    plugin_id: "task",
    action_id,
    input: action_input,
  }) as { success?: boolean; error?: string };
}

/** 验证 Agent 与 Workspace 仍属于当前 City。 */
async function assert_execution_target(
  context: PluginLifecycleContext,
  agent_id: string,
  workspace_id: string,
): Promise<void> {
  const [agents, workspaces] = await Promise.all([
    context.system.list_agents(),
    context.system.list_workspaces(),
  ]);
  if (!agents.some((agent) => agent.agent_id === agent_id && agent.plugin_ids.includes("task"))) {
    throw new Error(`Agent 未启用 Task Plugin: ${agent_id}`);
  }
  if (!workspaces.some((workspace) => workspace.workspace_id === workspace_id)) {
    throw new Error(`Workspace 不存在: ${workspace_id}`);
  }
}

/** 从统一 Store 读取目标 Task，供所有宿主管理入口共享。 */
async function read_existing_task(
  storage: PluginLifecycleContext["storage"],
  task_title: string,
) {
  const task_id = await resolveTaskIdByTitle({ storage, title: task_title });
  return await readTask({ storage, taskId: task_id });
}

/** 读取执行记录列表 action 输入。 */
function read_history_input(input: PluginJsonValue | undefined): TaskMainviewHistoryInput {
  return read_action_input(input);
}

/** 读取执行详情 action 输入。 */
function read_run_detail_input(input: PluginJsonValue | undefined): TaskMainviewRunDetailInput {
  return { ...read_history_input(input), timestamp: read_required_string(read_input_object(input).timestamp, "timestamp") };
}

/** 读取已有 Task 操作输入。 */
function read_action_input(input: PluginJsonValue | undefined): TaskMainviewActionInput {
  const value = read_input_object(input);
  return {
    task_title: read_required_string(value.task_title, "task_title"),
  };
}

/** 读取创建 Task 输入。 */
function read_create_input(input: PluginJsonValue | undefined): TaskMainviewCreateInput {
  const value = read_input_object(input);
  return {
    agent_id: read_required_string(value.agent_id, "agent_id"),
    workspace_id: read_required_string(value.workspace_id, "workspace_id"),
    title: read_required_string(value.title, "title"),
    description: read_required_string(value.description, "description"),
    when: read_required_string(value.when, "when"),
    kind: value.kind === "script" ? "script" : "agent",
    review: value.review === true,
    status: read_status(value.status),
    body: typeof value.body === "string" ? value.body : "",
  };
}

/** 读取更新 Task 输入。 */
function read_update_input(input: PluginJsonValue | undefined): TaskMainviewUpdateInput {
  const value = read_input_object(input);
  return { ...read_create_input(input), current_title: read_required_string(value.current_title, "current_title") };
}

/** 读取 Task 状态修改输入。 */
function read_status_input(input: PluginJsonValue | undefined): TaskMainviewStatusInput {
  const value = read_input_object(input);
  return { ...read_action_input(input), status: read_status(value.status) };
}

/** 读取合法 Task 状态。 */
function read_status(value: PluginJsonValue | undefined): "enabled" | "paused" | "disabled" {
  if (value === "enabled" || value === "paused" || value === "disabled") return value;
  throw new Error("status must be enabled, paused, or disabled");
}

/** 将 Plugin JSON 输入收窄为 object。 */
function read_input_object(input: PluginJsonValue | undefined): Record<string, PluginJsonValue> {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("Task action input must be an object");
  return input;
}

/** 读取一个必填非空字符串字段。 */
function read_required_string(value: PluginJsonValue | undefined, field: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${field} is required`);
  return value.trim();
}

/** 把结构化协议显式收敛到 Plugin JSON 边界。 */
function as_json(value: unknown): PluginJsonValue {
  return value as PluginJsonValue;
}
