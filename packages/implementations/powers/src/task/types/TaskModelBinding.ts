/** Task 后台模型基线与最小宿主模型端口；不携带账户凭据或 City 私有对象。 */
import type { TaskDeliverySession } from "./Task.js";

/** 在显式创建或确认时捕获的、可跨触发恢复的模型来源。 */
export interface TaskModelBinding {
  /** 精确模型 ID，不能按下一次运行的 Agent 默认值替换。 */
  model_id: string;
  /** 已确认的非秘密授权来源；后台任务要求可持久恢复的来源。 */
  binding_id: string;
}

/** 由定义决定的模型读取范围；交付 Session 只在同 Agent/Workspace 时提供。 */
export interface TaskModelTarget {
  /** 执行 Agent 的稳定 ID。 */
  agent_id: string;
  /** 执行 Workspace 的稳定 ID。 */
  workspace_id: string;
  /** 可继承模型的固定来源 Session；缺省时读取执行 Agent 默认模型。 */
  delivery_session?: TaskDeliverySession;
}

/** 补充普通 Power 句柄未暴露的模型读取和绑定；由可信宿主注入。 */
export interface TaskModelHost {
  /** 读取来源 Session 的已确认模型，或执行 Agent 默认模型；不得补全来源不明的历史。 */
  read(target: TaskModelTarget): Promise<TaskModelBinding | undefined>;
  /** 将精确模型和 binding 绑定到新 Session，校验来源有效后原子持久化；不得只比较模型 ID。 */
  bind(target: TaskModelTarget, session_id: string, binding: TaskModelBinding): Promise<void>;
}
