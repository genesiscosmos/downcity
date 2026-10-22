/**
 * Task 命令协议类型。
 *
 * 关键点（中文）
 * - task 模块相关 DTO 就近放在 task/types
 * - 统一给 CLI / Server / service 复用
 */

import type {
  ShipTaskKind,
  ShipTaskRunExecutionStatusV1,
  ShipTaskRunResultStatusV1,
  ShipTaskRunStatusV1,
  ShipTaskRunTriggerV1,
  ShipTaskStatus,
  TaskDeliverySession,
} from "./Task.js";
import type { TaskDefinitionIssue } from "./TaskPowerTypes.js";
import type { TaskState } from "./TaskWorkflow.js";

export type TaskCreateRequest = {
  /** 任务名称。 */
  title: string;
  /** 触发条件。 */
  when: string;
  /** 任务唯一绑定的执行 Workspace。 */
  workspace_id?: string;
  /** 任务执行类型。 */
  kind?: ShipTaskKind;
  /** 是否启用 review 多轮复核。 */
  review?: boolean;
  /** 调度启停状态。 */
  schedule?: ShipTaskStatus;
  /** 任务正文。 */
  body?: string;
};

export type TaskCreateResponse = {
  /** 稳定任务标识，后续操作优先使用此 ID。 */
  task_id?: string;
  /** 调用是否成功 */
  success: boolean;
  /** 任务名称（新建成功或复用已有任务时返回） */
  title?: string;
  /** 任务定义文件相对路径 */
  taskPath?: string;
  /** 说明信息（例如“复用已有任务”） */
  message?: string;
  /** 错误信息 */
  error?: string;
};

export type TaskUpdateRequest = {
  /** 当前任务名称。 */
  title: string;
  /** 新任务名称。 */
  titleNext?: string;
  /** 新触发条件。 */
  when?: string;
  /** 是否清空触发条件并回退到 `@manual`。 */
  clearWhen?: boolean;
  /** 新的执行 Agent；宿主管理界面可用它重新绑定执行目标。 */
  agent_id?: string;
  /** 新的执行 Workspace。 */
  workspace_id?: string;
  /** 新任务执行类型。 */
  kind?: ShipTaskKind;
  /** 是否启用 review 多轮复核。 */
  review?: boolean;
  /** 新调度启停状态。 */
  schedule?: ShipTaskStatus;
  /** 新任务正文。 */
  body?: string;
  /** 是否清空正文。 */
  clearBody?: boolean;
};

export type TaskUpdateResponse = {
  /** 修改后的稳定任务标识，重命名不改变它。 */
  task_id?: string;
  success: boolean;
  title?: string;
  taskPath?: string;
  error?: string;
};

export type TaskListItemView = {
  /** 工作进度、时间安排、发生历史与收件箱；调度 schedule 不表达完成。 */
  workflow: TaskState;
  /** 独立于标题的稳定任务标识。 */
  task_id: string;
  /** 任务名称。 */
  title: string;
  /** 任务正文。 */
  body?: string;
  /** 触发条件。 */
  when: string;
  /** 调度启停状态。 */
  schedule: ShipTaskStatus;
  /** 当前是否正在执行。 */
  running?: boolean;
  /** 任务唯一绑定的执行 Agent。 */
  agent_id: string;
  /** 任务唯一绑定的执行 Workspace。 */
  workspace_id: string;
  /** 创建 Task 时由调用上下文自动捕获的结果交付 Session。 */
  delivery_session?: TaskDeliverySession;
  /** 任务执行类型。 */
  kind?: ShipTaskKind;
  /** 是否启用 review 多轮复核。 */
  review?: boolean;
  /** 任务定义文件相对路径。 */
  taskPath: string;
  /** 最近一次运行时间戳。 */
  last_run_at?: string;
};

export type TaskListResponse = {
  /** Task 列表读取是否完成。 */
  success: true;
  /** 当前调用范围内可以正常使用的 Task。 */
  tasks: TaskListItemView[];
  /** Store 中无法读取或解析、因此不会进入执行路径的定义。 */
  issues: TaskDefinitionIssue[];
};

/** 读取一个 Task 全部执行记录的输入。 */
export interface TaskRunHistoryRequest {
  /** Task 的唯一标题。 */
  readonly title: string;
}

/** 读取一条 Task 执行记录详情的输入。 */
export interface TaskRunDetailRequest {
  /** Task 的唯一标题。 */
  readonly title: string;

  /** Run 目录使用的稳定 UTC 时间戳。 */
  readonly timestamp: string;
}

/** Task 执行记录列表中的一条摘要。 */
export interface TaskRunHistoryItemView {
  /** Run 目录使用的稳定 UTC 时间戳。 */
  readonly timestamp: string;

  /** 本次执行的唯一标识；早期或不完整记录可能不存在。 */
  readonly execution_id?: string;

  /** 当前或最终执行状态。 */
  readonly status: "running" | ShipTaskRunStatusV1;

  /** 本次执行的触发来源。 */
  readonly trigger: ShipTaskRunTriggerV1["type"];

  /** 执行开始时间，使用 Unix 毫秒时间戳。 */
  readonly started_at: number;

  /** 最近状态更新时间，使用 Unix 毫秒时间戳。 */
  readonly updated_at: number;

  /** 执行结束时间，使用 Unix 毫秒时间戳。 */
  readonly ended_at?: number;

  /** 已完成执行的总耗时，单位为毫秒。 */
  readonly duration_ms?: number;

  /** 运行中记录当前所在阶段。 */
  readonly phase?: string;

  /** 运行中记录当前阶段的用户可读说明。 */
  readonly message?: string;

  /** Agent 或脚本执行阶段的最终状态。 */
  readonly execution_status?: ShipTaskRunExecutionStatusV1;

  /** 最终产物的校验状态。 */
  readonly result_status?: ShipTaskRunResultStatusV1;

  /** 执行失败时的简短错误摘要。 */
  readonly error?: string;
}

/** Task 一次执行的完整只读详情。 */
export interface TaskRunDetailView extends TaskRunHistoryItemView {
  /** 本次执行的最终输出正文。 */
  readonly output: string;

  /** 本次执行的完整错误正文。 */
  readonly error_detail: string;

  /** 结果校验失败项。 */
  readonly result_errors: string[];

  /** Agent 实际完成的对话轮数。 */
  readonly dialogue_rounds?: number;
}

/** Task 执行记录列表的领域响应。 */
export interface TaskRunHistoryResponse {
  /** 读取是否成功。 */
  readonly success: boolean;

  /** 按时间倒序排列的执行记录。 */
  readonly runs?: TaskRunHistoryItemView[];

  /** 读取失败时的错误信息。 */
  readonly error?: string;
}

/** Task 执行记录详情的领域响应。 */
export interface TaskRunDetailResponse {
  /** 读取是否成功。 */
  readonly success: boolean;

  /** 成功读取的执行详情。 */
  readonly run?: TaskRunDetailView;

  /** 读取失败时的错误信息。 */
  readonly error?: string;
}

export type TaskRunRequest = {
  /** 要执行的 Task 唯一标题。 */
  title: string;
  /** 手动执行原因；scheduler 触发时通常省略。 */
  reason?: string;
  /** 重试指定周期发生项时提供，重试不产生新的计划事项。 */
  occurrence_id?: string;
  /**
   * TaskPower scheduler 注入的内部触发来源。
   *
   * 该字段不进入 Agent 可见 JSON Schema；普通调用省略时固定视为 manual。
   */
  scheduler_trigger?: "cron" | "time";
  /** 调度器读取的触发规则，受理时与最新定义比较，拒绝过期回调。 */
  expected_when?: string;
};

export type TaskRunResponse = {
  success: boolean;
  /** 是否已受理后台执行（true 表示任务已开始异步执行） */
  accepted?: boolean;
  /** 给调用方的简短提示（例如“任务已开始，完成后结果会写入关联 Session，请直接继续后续流程，无需等待完成”）。 */
  message?: string;
  /** 本次执行 ID（可用于 UI 关联执行状态） */
  executionId?: string;
  status?: ShipTaskRunStatusV1;
  executionStatus?: ShipTaskRunExecutionStatusV1;
  resultStatus?: ShipTaskRunResultStatusV1;
  resultErrors?: string[];
  dialogueRounds?: number;
  userSimulatorSatisfied?: boolean;
  userSimulatorReply?: string;
  userSimulatorReason?: string;
  userSimulatorScore?: number;
  title?: string;
  timestamp?: string;
  runDir?: string;
  runDirRel?: string;
  error?: string;
};

export type TaskSetStatusRequest = {
  title: string;
  status: ShipTaskStatus;
};

export type TaskSetStatusResponse = {
  /** 状态操作关联的稳定任务标识。 */
  task_id?: string;
  success: boolean;
  title?: string;
  status?: ShipTaskStatus;
  error?: string;
};

export type TaskDeleteRequest = {
  title: string;
};

export type TaskDeleteResponse = {
  /** 已删除任务的稳定标识，供清除调度与通知。 */
  task_id?: string;
  success: boolean;
  title?: string;
  taskDirPath?: string;
  error?: string;
};
