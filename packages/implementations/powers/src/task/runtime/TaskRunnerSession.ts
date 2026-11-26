/**
 * TaskRunnerSession：task runner 的 session 装配模块。
 *
 * 关键点（中文）
 * - 负责通过宿主 Agent 的 Session 集合创建 task session。
 * - canonical Message 只由执行 Agent 的 Session 存储持有。
 * - 这些能力与任务编排逻辑解耦后，task 主流程会更聚焦于状态流转。
 * - 当前只有 api 执行模式。
 */

import type { PowerContext, PowerSessionHandle, PowerStorage } from "@downcity/city/power";
import { SESSION_KIND_TASK, SESSION_TYPE_WORK } from "@downcity/type";
import type { TaskSessionRuntimePort } from "@/task/types/TaskRunner.js";
import type { TaskDefinitionV1, TaskDeliverySession } from "@/task/types/Task.js";
import { validate_task_model } from "./TaskModelBinding.js";
import { authorize_task_session, TASK_EXECUTION_PROFILE } from "./TaskSessionAuthorization.js";
import type { TaskModelHost } from "../types/TaskModelBinding.js";

/**
 * 构建 task 专用 Session 运行时。
 *
 * 关键点（中文）
 * - Executor、Power tools 与 system blocks 来自宿主 Agent；TaskPower 按 Session 来源排除自身。
 * - 执行器和模拟评审器都直接处理本次运行，统一委派策略禁止它们继续分派。
 * - run 目录仍保留 task 专用调试消息，宿主 Session 保存实际执行历史。
 */
export async function createTaskSessionRuntimePort(params: {
  /** 受理时固定的完整任务模型基线。 */
  task: TaskDefinitionV1;
  /** 宿主校验执行 Agent 的当前模型是否符合任务已确认的来源与授权基线。 */
  model_host?: TaskModelHost;
  context: PowerContext;
  /** Task 运行记录所属的 TaskPower 生命周期级存储。 */
  storage: PowerStorage;
  runDirAbs: string;
  runSessionId: string;
  userSimulatorSessionId: string;
  delivery_session?: TaskDeliverySession;
}): Promise<TaskSessionRuntimePort> {
  const { context, runSessionId, userSimulatorSessionId } = params;
  const binding = await validate_task_model(params.task, params.model_host);
  if (!binding || !params.model_host) throw new Error("task_model_configuration_required");
  // 执行器和评审器统一继承执行 Agent 的模型。
  const task_session = await context.agent.sessions.create({
    type: SESSION_TYPE_WORK,
    kind: SESSION_KIND_TASK,
    execution_profile: TASK_EXECUTION_PROFILE,
  });
  const user_simulator_session = await context.agent.sessions.create({
    type: SESSION_TYPE_WORK,
    kind: SESSION_KIND_TASK,
    execution_profile: TASK_EXECUTION_PROFILE,
    // 独立评审会话仍使用 task 用途，执行器和评审器均禁止继续分派。
  });
  // 授权回执属于本次 Task 运行；后续每次模型使用校验 Turn 捕获的模型。
  await authorize_task_session(params.storage, params.task, task_session.id);
  await authorize_task_session(params.storage, params.task, user_simulator_session.id);
  await validate_task_model(params.task, params.model_host);
  const sessions_by_alias = new Map<string, PowerSessionHandle>([
    [runSessionId, context.agent.sessions.runtime(task_session.id, SESSION_TYPE_WORK)],
    [userSimulatorSessionId, context.agent.sessions.runtime(user_simulator_session.id, SESSION_TYPE_WORK)],
  ]);
  return {
    get_session(session_id: string): PowerSessionHandle {
      const key = String(session_id || "").trim();
      const session = sessions_by_alias.get(key);
      if (!session) throw new Error(`Task session "${key}" is not registered`);
      return session;
    },
  };
}
