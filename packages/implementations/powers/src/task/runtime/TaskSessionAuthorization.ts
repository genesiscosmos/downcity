/** Task 执行授权回执：会话只引用执行 Agent，Task 自己保存并校验该次运行已确认的来源与授权。 */
import { z } from "zod";
import { is_model_reference, SESSION_HOOK_POINTS, SESSION_KIND_TASK } from "@downcity/type";
import type { PowerHooks, PowerLifecycleContext, PowerStorage } from "@downcity/city/power";
import type { TaskDefinitionV1 } from "../types/Task.js";
import { require_task_model } from "./TaskModelBinding.js";
import { assert_execution_model } from "../../builtin/ExecutionModelAuthorization.js";

/** Task profile 只固定 Power 执行权限依赖，不替换 Agent 能力或模型。 */
export const TASK_EXECUTION_PROFILE = Object.freeze({ id: "task", version: 1 });

const authorization_schema = z.object({
  agent_id: z.string().min(1), workspace_id: z.string().min(1), task_id: z.string().min(1),
  model: z.custom<import("@downcity/type").ModelReference>(is_model_reference), binding_id: z.string().min(1),
}).strict();

/** 会话 ID 只用于 Task 私有授权索引，不允许任意路径段。 */
function authorization_path(session_id: string): string {
  return `session-authorizations/${z.uuid().parse(session_id)}.json`;
}

/** 在 prompt 前保存本次任务基线；此回执只限制执行，不成为 Session 模型配置。 */
export async function authorize_task_session(storage: PowerStorage, task: TaskDefinitionV1, session_id: string): Promise<void> {
  const baseline = require_task_model(task);
  const record = authorization_schema.parse({ agent_id: task.agent_id, workspace_id: task.workspace_id, task_id: task.taskId, ...baseline });
  await storage.files.ensure_directory("session-authorizations");
  await storage.files.write_file_atomically(authorization_path(session_id), JSON.stringify(record));
}

/** 守卫使用模型请求捕获的身份，不读取 Agent 当前模型来代替本轮实际模型。 */
export function task_execution_hooks(host: () => PowerLifecycleContext): PowerHooks {
  return { guard: { [SESSION_HOOK_POINTS.model_execution]: [async ({ context, value }) => {
    if (context.session?.kind !== SESSION_KIND_TASK) return;
    const current = host();
    const record = authorization_schema.parse(JSON.parse((await current.storage.files.read_file(authorization_path(context.session.id))).toString("utf8")));
    if (record.agent_id !== context.agent.id || record.workspace_id !== context.workspace?.id) throw new Error("Task execution authorization is outside its Agent or Workspace");
    assert_execution_model(record, value, current.town);
  }] } };
}
