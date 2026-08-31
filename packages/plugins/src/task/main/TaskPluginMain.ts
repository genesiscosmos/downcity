/** Task Plugin 工作区的宿主 main actions。 */

import { define_plugin_main, type PluginJsonValue, type PluginMainContext } from "@downcity/plugin";
import type { TaskListItemView } from "@/task/types/TaskCommand.js";
import type { TaskMainviewContextInput, TaskMainviewItem, TaskMainviewSnapshot } from "@/task/types/TaskMainview.js";

/** Task Plugin 的宿主管理入口。 */
export const TASK_PLUGIN_MAIN = define_plugin_main({
  activate(context) {
    context.plugin.action({
      id: "tasks.snapshot",
      run: async (input) => as_json(await create_snapshot(context, read_context(input))),
    });
  },
});

/** 通过 Agent Plugin action 读取 Task，保持 Task runtime 为唯一事实源。 */
async function create_snapshot(
  context: PluginMainContext,
  input: TaskMainviewContextInput,
): Promise<TaskMainviewSnapshot> {
  const [agents, workspaces] = await Promise.all([
    context.system.list_agents(),
    context.system.list_workspaces(),
  ]);
  const task_agents = agents.filter((agent) => agent.plugin_ids.includes("task"));
  const agent_id = input.agent_id && task_agents.some((agent) => agent.agent_id === input.agent_id)
    ? input.agent_id
    : task_agents[0]?.agent_id;
  const workspace_id = input.workspace_id && workspaces.some((workspace) => workspace.workspace_id === input.workspace_id)
    ? input.workspace_id
    : workspaces[0]?.workspace_id;
  let tasks: TaskMainviewItem[] = [];
  if (agent_id && workspace_id) {
    const result = await context.system.invoke_agent_plugin({
      agent_id,
      workspace_id,
      plugin_id: "task",
      action_id: "list",
      input: {},
    }) as unknown as { success?: boolean; data?: { tasks?: TaskListItemView[] }; error?: string };
    if (!result.success) throw new Error(result.error || "Task list failed");
    tasks = (result.data?.tasks ?? []).map((task) => ({
      title: task.title,
      description: task.description,
      ...(task.body ? { body: task.body } : {}),
      when: task.when,
      status: task.status,
      ...(task.kind ? { kind: task.kind } : {}),
      session_id: task.session_id,
      ...(task.lastRunTimestamp ? { last_run_at: task.lastRunTimestamp } : {}),
    }));
  }
  return {
    agents: task_agents.map((agent) => ({ agent_id: agent.agent_id })),
    workspaces: workspaces.map((workspace) => ({ workspace_id: workspace.workspace_id, name: workspace.name })),
    tasks,
  };
}

/** 读取可选 Agent 与 Workspace 上下文。 */
function read_context(input: PluginJsonValue | undefined): TaskMainviewContextInput {
  if (!input || typeof input !== "object" || Array.isArray(input)) return {};
  return {
    ...(typeof input.agent_id === "string" ? { agent_id: input.agent_id.trim() } : {}),
    ...(typeof input.workspace_id === "string" ? { workspace_id: input.workspace_id.trim() } : {}),
  };
}

/** 把结构化协议显式收敛到 Plugin JSON 边界。 */
function as_json(value: unknown): PluginJsonValue {
  return value as PluginJsonValue;
}
