/**
 * TaskRunnerSession：task runner 的 session 装配模块。
 *
 * 关键点（中文）
 * - 负责通过宿主 Agent 的 Session 集合创建 task session。
 * - canonical Message 只由宿主 Agent Session 的 `session.db` 持有。
 * - 这些能力与任务编排逻辑解耦后，task 主流程会更聚焦于状态流转。
 * - 当前只有 api 执行模式。
 */

import type { PowerContext, PowerSessionHandle, PowerStorage } from "@downcity/city/power";
import { SESSION_KIND_TASK, SESSION_TYPE_WORK } from "@downcity/type";
import type { TaskSessionRuntimePort } from "@/task/types/TaskRunner.js";
import type { TaskDeliverySession } from "@/task/types/Task.js";

/**
 * 构建 task 专用 Session 运行时。
 *
 * 关键点（中文）
 * - Executor、Power tools 与 system blocks 来自宿主 Agent；TaskPower 按 Session 来源排除自身。
 * - 执行器和模拟评审器都直接处理本次运行，统一委派策略禁止它们继续分派。
 * - run 目录仍保留 task 专用调试消息，宿主 Session 保存实际执行历史。
 */
export async function createTaskSessionRuntimePort(params: {
  context: PowerContext;
  /** Task 运行记录所属的 TaskPower 生命周期级存储。 */
  storage: PowerStorage;
  runDirAbs: string;
  runSessionId: string;
  userSimulatorSessionId: string;
  delivery_session?: TaskDeliverySession;
}): Promise<TaskSessionRuntimePort> {
  const { context, runSessionId, userSimulatorSessionId } = params;
  // 交付 Session 可能属于另一个 Agent；只有同 Agent Session 才能继承模型配置。
  const inherit_model_from = params.delivery_session?.agent_id === context.agent.id
    && params.delivery_session.workspace_id === (context.workspace?.id ?? null)
    ? {
        session_id: params.delivery_session.session_id,
        type: params.delivery_session.type,
      }
    : undefined;
  const task_session = await context.agent.sessions.create({
    type: SESSION_TYPE_WORK,
    kind: SESSION_KIND_TASK,
    ...(inherit_model_from ? { inherit_model_from } : {}),
  });
  const user_simulator_session = await context.agent.sessions.create({
    type: SESSION_TYPE_WORK,
    kind: SESSION_KIND_TASK,
    // 独立评审会话仍使用 task 用途，执行器和评审器均禁止继续分派。
    ...(inherit_model_from ? { inherit_model_from } : {}),
  });
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
