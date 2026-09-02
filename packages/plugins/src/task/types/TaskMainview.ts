/** Task Plugin 工作区与宿主 main 之间的 JSON 协议。 */

import type { TaskRunDetailView, TaskRunHistoryItemView } from "./TaskCommand.js";
import type { ShipTaskKind, ShipTaskStatus, TaskDeliverySession } from "./Task.js";

/** Task 工作区中的 Agent 摘要。 */
export interface TaskMainviewAgent {
  /** Agent 的稳定 ID。 */
  readonly agent_id: string;

  /** Agent 的用户可见名称。 */
  readonly name: string;

  /** 当前 Agent 拥有的全部 Task。 */
  readonly tasks: TaskMainviewItem[];
}

/** Task 工作区中的 Workspace 摘要。 */
export interface TaskMainviewWorkspace {
  /** Workspace 的稳定 ID。 */
  readonly workspace_id: string;

  /** Workspace 的用户可见名称。 */
  readonly name: string;
}

/** Task 工作区展示的一条任务定义。 */
export interface TaskMainviewItem {
  /** Task 的稳定标题。 */
  readonly title: string;

  /** Task 的用途说明。 */
  readonly description: string;

  /** Task 的完整执行正文。 */
  readonly body?: string;

  /** Task 的触发条件。 */
  readonly when: string;

  /** Task 当前状态。 */
  readonly status: string;

  /** Task 执行类型。 */
  readonly kind?: "agent" | "script";

  /** Task 创建时自动绑定的结果交付 Session。 */
  readonly delivery_session?: TaskDeliverySession;

  /** Task 唯一绑定的执行 Workspace。 */
  readonly workspace_id: string;

  /** 是否启用 Agent 多轮复核。 */
  readonly review: boolean;

  /** 最近一次运行时间。 */
  readonly last_run_at?: string;
}

/** Task 工作区一次读取返回的完整快照。 */
export interface TaskMainviewSnapshot {
  /** 当前可管理的 Agent，以及各 Agent 在所选 Workspace 下的 Task。 */
  readonly agents: TaskMainviewAgent[];

  /** 当前可提供执行上下文的 Workspace。 */
  readonly workspaces: TaskMainviewWorkspace[];
}

/** Task Mainview 读取执行记录列表的输入。 */
export interface TaskMainviewHistoryInput {
  /** 拥有目标 Task 的 Agent ID。 */
  readonly agent_id: string;

  /** Task 本次执行使用的 Workspace ID。 */
  readonly workspace_id: string;

  /** 目标 Task 的唯一标题。 */
  readonly task_title: string;
}

/** Task Mainview 读取单次执行详情的输入。 */
export interface TaskMainviewRunDetailInput extends TaskMainviewHistoryInput {
  /** Run 目录使用的稳定 UTC 时间戳。 */
  readonly timestamp: string;
}

/** Task Mainview 执行记录列表响应。 */
export interface TaskMainviewHistorySnapshot {
  /** 按时间倒序排列的执行记录。 */
  readonly runs: TaskRunHistoryItemView[];
}

/** Task Mainview 单次执行详情响应。 */
export interface TaskMainviewRunDetailSnapshot {
  /** 当前选择的完整执行记录。 */
  readonly run: TaskRunDetailView;
}

/** Task Mainview 创建 Task 的输入。 */
export interface TaskMainviewCreateInput {
  /** Task 所属 Agent。 */
  readonly agent_id: string;
  /** Task 唯一绑定的执行 Workspace。 */
  readonly workspace_id: string;
  /** Task 的唯一标题。 */
  readonly title: string;
  /** Task 的用途说明。 */
  readonly description: string;
  /** Task 的触发条件。 */
  readonly when: string;
  /** Task 的执行类型。 */
  readonly kind: ShipTaskKind;
  /** 是否启用多轮复核。 */
  readonly review: boolean;
  /** Task 的初始状态。 */
  readonly status: ShipTaskStatus;
  /** Task 的完整执行正文。 */
  readonly body: string;
}

/** Task Mainview 更新 Task 的输入。 */
export interface TaskMainviewUpdateInput extends TaskMainviewCreateInput {
  /** 修改前的 Task 唯一标题。 */
  readonly current_title: string;
}

/** Task Mainview 对已有 Task 执行单一操作的输入。 */
export interface TaskMainviewActionInput {
  /** Task 所属 Agent。 */
  readonly agent_id: string;
  /** Task 唯一绑定的执行 Workspace。 */
  readonly workspace_id: string;
  /** 目标 Task 的唯一标题。 */
  readonly task_title: string;
}

/** Task Mainview 修改启停状态的输入。 */
export interface TaskMainviewStatusInput extends TaskMainviewActionInput {
  /** 要写入的 Task 状态。 */
  readonly status: ShipTaskStatus;
}

/** Task Mainview mutation 的稳定结果。 */
export interface TaskMainviewMutationResult {
  /** 操作完成后的 Task 标题。 */
  readonly task_title: string;
}

/** Task 创建或编辑表单中的完整可变草稿。 */
export interface TaskMainviewEditorDraft {
  /** Task 唯一绑定的执行 Workspace。 */
  readonly workspace_id: string;
  /** Task 的唯一标题。 */
  readonly title: string;
  /** Task 的用途说明。 */
  readonly description: string;
  /** Task 的触发条件。 */
  readonly when: string;
  /** Task 的执行类型。 */
  readonly kind: ShipTaskKind;
  /** 是否启用 Agent 多轮复核。 */
  readonly review: boolean;
  /** Task 当前启停状态。 */
  readonly status: ShipTaskStatus;
  /** Task 的完整执行正文。 */
  readonly body: string;
}
