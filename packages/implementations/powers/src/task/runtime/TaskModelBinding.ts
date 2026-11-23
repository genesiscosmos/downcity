/** Task 模型身份校验：只在创建/明确确认时捕获，触发和重试仅校验持久基线。 */
import { is_model_reference, same_model } from "@downcity/type";
import type { TaskDefinitionV1 } from "../types/Task.js";
import type { TaskModelBinding, TaskModelHost, TaskModelTarget } from "../types/TaskModelBinding.js";

/** 交付与执行目标相同时才允许继承其模型；保持 Task 已有来源规则。 */
export function task_model_target(task: Pick<TaskDefinitionV1, "agent_id" | "workspace_id" | "delivery_session">): TaskModelTarget {
  const delivery_session = task.delivery_session?.agent_id === task.agent_id
    && task.delivery_session.workspace_id === task.workspace_id ? task.delivery_session : undefined;
  return { agent_id: task.agent_id, workspace_id: task.workspace_id, ...(delivery_session ? { delivery_session } : {}) };
}

/** 后台来源缺失必须明确配置；不从当前 Town 账号或模型目录猜测。 */
export function require_task_model(binding: Partial<TaskModelBinding> | undefined): TaskModelBinding {
  if (!is_model_reference(binding?.model)
    || typeof binding.binding_id !== "string" || !binding.binding_id.trim()) {
    throw Object.assign(new Error("Task requires configuration: explicitly confirm an execution model and durable authorization binding"), { code: "task_model_configuration_required" });
  }
  return { model: binding.model, binding_id: binding.binding_id };
}

/** 调度前和实际装配前都核对定义基线；读取当前值不能更新已保存身份。 */
export async function validate_task_model(task: TaskDefinitionV1, host?: TaskModelHost): Promise<TaskModelBinding | undefined> {
  if (task.kind !== "agent") return undefined;
  const expected = require_task_model(task);
  if (!host) throw Object.assign(new Error("Task requires configuration: host model binding adapter is unavailable"), { code: "task_model_configuration_required" });
  const current = require_task_model(await host.read(task_model_target(task)));
  if (!same_model(current.model, expected.model) || current.binding_id !== expected.binding_id) {
    throw Object.assign(new Error("Task execution model or authorization changed; explicit confirmation is required"), { code: "task_model_binding_changed" });
  }
  return expected;
}
