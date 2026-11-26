/** Task 后台模型基线与最小宿主模型端口；不携带账户凭据或 City 私有对象。 */
import type { ModelReference } from "@downcity/type";
import type { TaskDeliverySession } from "./Task.js";

/** 在显式创建或确认时捕获的、可跨触发恢复的模型来源。 */
export interface TaskModelBinding {
  /** 精确模型 ID，不能按下一次运行的 Agent 默认值替换。 */
  model: ModelReference;
  /** 已确认的非秘密授权来源；后台任务要求可持久恢复的来源。 */
  binding_id: string;
}

/** 由定义决定的模型读取范围；交付 Session 只在同 Agent/Workspace 时提供。 */
export interface TaskModelTarget {
  /** 执行 Agent 的稳定 ID。 */
  agent_id: string;
  /** 执行 Workspace 的稳定 ID。 */
  workspace_id: string;
  /** 交付身份的范围校验；模型始终读取执行 Agent 定义。 */
  delivery_session?: TaskDeliverySession;
}

/** 补充普通 Power 句柄未暴露的模型读取和绑定；由可信宿主注入。 */
export interface TaskModelHost {
  /** 读取执行 Agent 已确认的模型；不得补全来源不明的历史。 */
  read(target: TaskModelTarget): Promise<TaskModelBinding | undefined>;
}
