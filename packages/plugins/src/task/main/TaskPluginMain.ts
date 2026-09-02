/**
 * Task Plugin 工作区的宿主管理 actions。
 *
 * Task 定义归属于 Agent，并显式绑定一个执行 Workspace。Plugin main 只负责校验宿主管理
 * 范围与转发，Task runtime 仍是定义、调度、执行记录和 mutation 的唯一事实源。
 */

import { define_plugin_main, type PluginJsonValue, type PluginMainContext } from "@downcity/plugin";
import type { TaskListItemView, TaskRunDetailView, TaskRunHistoryItemView } from "@/task/types/TaskCommand.js";
import type {
  TaskMainviewActionInput,
  TaskMainviewCreateInput,
  TaskMainviewHistoryInput,
  TaskMainviewHistorySnapshot,
  TaskMainviewItem,
  TaskMainviewMutationResult,
  TaskMainviewRunDetailInput,
  TaskMainviewRunDetailSnapshot,
  TaskMainviewSnapshot,
  TaskMainviewStatusInput,
  TaskMainviewUpdateInput,
} from "@/task/types/TaskMainview.js";

/** Task Plugin 的宿主管理入口。 */
export const TASK_PLUGIN_MAIN = define_plugin_main({
  activate(context) {
    register_read_actions(context);
    register_mutation_actions(context);
  },
});

/** 注册 Task 工作区的只读 actions。 */
function register_read_actions(context: PluginMainContext): void {
  context.plugin.action({ id: "tasks.snapshot", run: async () => as_json(await create_snapshot(context)) });
  context.plugin.action({ id: "tasks.history", run: async (input) => as_json(await read_history(context, read_history_input(input))) });
  context.plugin.action({ id: "tasks.run_detail", run: async (input) => as_json(await read_run_detail(context, read_run_detail_input(input))) });
}

/** 注册 Task 工作区的管理 actions。 */
function register_mutation_actions(context: PluginMainContext): void {
  context.plugin.action({ id: "tasks.create", run: async (input) => as_json(await create_task(context, read_create_input(input))) });
  context.plugin.action({ id: "tasks.update", run: async (input) => as_json(await update_task(context, read_update_input(input))) });
  context.plugin.action({ id: "tasks.status", run: async (input) => as_json(await set_task_status(context, read_status_input(input))) });
  context.plugin.action({ id: "tasks.run", run: async (input) => as_json(await run_task(context, read_action_input(input))) });
  context.plugin.action({ id: "tasks.delete", run: async (input) => as_json(await delete_task(context, read_action_input(input))) });
}

/** 读取全部启用 Task Plugin 的 Agent 与 Agent 级 Task。 */
async function create_snapshot(context: PluginMainContext): Promise<TaskMainviewSnapshot> {
  const [agents, workspaces] = await Promise.all([context.system.list_agents(), context.system.list_workspaces()]);
  const task_agents = agents.filter((agent) => agent.plugin_ids.includes("task"));
  const transport_workspace_id = workspaces[0]?.workspace_id;
  const agent_snapshots = await Promise.all(task_agents.map(async (agent) => ({
    agent_id: agent.agent_id,
    name: agent.name,
    tasks: transport_workspace_id ? await read_agent_tasks(context, agent.agent_id, transport_workspace_id) : [],
  })));
  return {
    agents: agent_snapshots,
    workspaces: workspaces.map((workspace) => ({ workspace_id: workspace.workspace_id, name: workspace.name })),
  };
}

/** 从 Agent Plugin runtime 读取一个 Agent 的 Task 投影。 */
async function read_agent_tasks(context: PluginMainContext, agent_id: string, workspace_id: string): Promise<TaskMainviewItem[]> {
  const data = await invoke_task_action<{ tasks?: TaskListItemView[] }>(context, {
    agent_id,
    workspace_id,
    action_id: "list",
    input: {},
    error_message: `读取 ${agent_id} 的 Task 失败`,
  });
  return (data.tasks ?? []).map((task) => ({
    title: task.title,
    description: task.description,
    ...(task.body ? { body: task.body } : {}),
    when: task.when,
    status: task.status,
    kind: task.kind || "agent",
    review: Boolean(task.review),
    workspace_id: task.workspace_id,
    ...(task.delivery_session ? { delivery_session: task.delivery_session } : {}),
    ...(task.lastRunTimestamp ? { last_run_at: task.lastRunTimestamp } : {}),
  }));
}

/** 读取一个 Task 的执行记录列表。 */
async function read_history(context: PluginMainContext, input: TaskMainviewHistoryInput): Promise<TaskMainviewHistorySnapshot> {
  await assert_task_context(context, input);
  const data = await invoke_task_action<{ runs?: TaskRunHistoryItemView[] }>(context, {
    ...input,
    action_id: "history",
    input: { title: input.task_title },
    error_message: `读取 ${input.task_title} 的执行记录失败`,
  });
  return { runs: data.runs ?? [] };
}

/** 读取一条 Task 执行详情。 */
async function read_run_detail(context: PluginMainContext, input: TaskMainviewRunDetailInput): Promise<TaskMainviewRunDetailSnapshot> {
  await assert_task_context(context, input);
  const data = await invoke_task_action<{ run?: TaskRunDetailView }>(context, {
    ...input,
    action_id: "run_detail",
    input: { title: input.task_title, timestamp: input.timestamp },
    error_message: `读取 ${input.task_title} 的执行详情失败`,
  });
  if (!data.run) throw new Error(`执行记录不存在: ${input.timestamp}`);
  return { run: data.run };
}

/** 创建一个绑定 Workspace 的 Task。 */
async function create_task(context: PluginMainContext, input: TaskMainviewCreateInput): Promise<TaskMainviewMutationResult> {
  await assert_task_context(context, input);
  await invoke_task_action(context, {
    ...input,
    action_id: "create",
    input: {
      title: input.title,
      description: input.description,
      workspace_id: input.workspace_id,
      when: input.when,
      kind: input.kind,
      review: input.review,
      status: input.status,
      body: input.body,
    },
    error_message: `创建 ${input.title} 失败`,
  });
  return { task_title: input.title };
}

/** 原子更新一个 Task 定义。 */
async function update_task(context: PluginMainContext, input: TaskMainviewUpdateInput): Promise<TaskMainviewMutationResult> {
  await assert_task_context(context, input);
  await invoke_task_action(context, {
    ...input,
    action_id: "update",
    input: {
      title: input.current_title,
      titleNext: input.title,
      description: input.description,
      workspace_id: input.workspace_id,
      when: input.when,
      kind: input.kind,
      review: input.review,
      status: input.status,
      body: input.body,
    },
    error_message: `更新 ${input.current_title} 失败`,
  });
  return { task_title: input.title };
}

/** 修改 Task 启停状态。 */
async function set_task_status(context: PluginMainContext, input: TaskMainviewStatusInput): Promise<TaskMainviewMutationResult> {
  await invoke_existing_task_action(context, input, "status", { title: input.task_title, status: input.status });
  return { task_title: input.task_title };
}

/** 异步受理一次手动 Task 执行。 */
async function run_task(context: PluginMainContext, input: TaskMainviewActionInput): Promise<TaskMainviewMutationResult> {
  await invoke_existing_task_action(context, input, "run", { title: input.task_title });
  return { task_title: input.task_title };
}

/** 删除 Task 定义及其全部执行记录。 */
async function delete_task(context: PluginMainContext, input: TaskMainviewActionInput): Promise<TaskMainviewMutationResult> {
  await invoke_existing_task_action(context, input, "delete", { title: input.task_title });
  return { task_title: input.task_title };
}

/** 调用一个已有 Task 的 mutation action。 */
async function invoke_existing_task_action(
  context: PluginMainContext,
  input: TaskMainviewActionInput,
  action_id: "status" | "run" | "delete",
  action_input: PluginJsonValue,
): Promise<void> {
  await assert_task_context(context, input);
  await invoke_task_action(context, {
    ...input,
    action_id,
    input: action_input,
    error_message: `${action_id} ${input.task_title} 失败`,
  });
}

/** 统一调用 Agent Task runtime，并保留业务失败语义。 */
async function invoke_task_action<Data = Record<string, never>>(
  context: PluginMainContext,
  input: {
    readonly agent_id: string;
    readonly workspace_id: string;
    readonly action_id: string;
    readonly input: PluginJsonValue;
    readonly error_message: string;
  },
): Promise<Data> {
  const result = await context.system.invoke_agent_plugin({
    agent_id: input.agent_id,
    workspace_id: input.workspace_id,
    plugin_id: "task",
    action_id: input.action_id,
    input: input.input,
  }) as unknown as { success?: boolean; data?: Data; error?: string };
  if (!result.success) throw new Error(result.error || input.error_message);
  return result.data ?? {} as Data;
}

/** 验证 Agent 与 Workspace 仍属于当前宿主管理范围。 */
async function assert_task_context(context: PluginMainContext, input: { readonly agent_id: string; readonly workspace_id: string }): Promise<void> {
  const [agents, workspaces] = await Promise.all([context.system.list_agents(), context.system.list_workspaces()]);
  if (!agents.some((agent) => agent.agent_id === input.agent_id && agent.plugin_ids.includes("task"))) {
    throw new Error(`Agent 未启用 Task Plugin: ${input.agent_id}`);
  }
  if (!workspaces.some((workspace) => workspace.workspace_id === input.workspace_id)) {
    throw new Error(`Workspace 不存在: ${input.workspace_id}`);
  }
}

/** 读取执行记录列表 action 输入。 */
function read_history_input(input: PluginJsonValue | undefined): TaskMainviewHistoryInput {
  return read_action_input(input);
}

/** 读取执行详情 action 输入。 */
function read_run_detail_input(input: PluginJsonValue | undefined): TaskMainviewRunDetailInput {
  return { ...read_action_input(input), timestamp: read_required_string(read_input_object(input).timestamp, "timestamp") };
}

/** 读取已有 Task 操作输入。 */
function read_action_input(input: PluginJsonValue | undefined): TaskMainviewActionInput {
  const value = read_input_object(input);
  return {
    agent_id: read_required_string(value.agent_id, "agent_id"),
    workspace_id: read_required_string(value.workspace_id, "workspace_id"),
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
