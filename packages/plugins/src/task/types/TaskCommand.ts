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
  ShipTaskStatus,
} from "./Task.js";

export type TaskCreateRequest = {
  /** 任务名称。 */
  title: string;
  /** 触发条件。 */
  when: string;
  /** 任务描述。 */
  description: string;
  /** 任务会话标识。 */
  session_id: string;
  /** 任务执行类型。 */
  kind?: ShipTaskKind;
  /** 是否启用 review 多轮复核。 */
  review?: boolean;
  /** 任务状态。 */
  status?: ShipTaskStatus;
  /** 任务正文。 */
  body?: string;
  /** 是否覆盖已有定义。 */
  overwrite?: boolean;
};

export type TaskCreateResponse = {
  /** 调用是否成功 */
  success: boolean;
  /** 任务名称（新建成功或复用已有任务时返回） */
  title?: string;
  /** 任务定义文件相对路径 */
  taskMdPath?: string;
  /** 是否复用了已有任务（true 表示未新建） */
  reusedExisting?: boolean;
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
  /** 新任务描述。 */
  description?: string;
  /** 新会话标识。 */
  session_id?: string;
  /** 新任务执行类型。 */
  kind?: ShipTaskKind;
  /** 是否启用 review 多轮复核。 */
  review?: boolean;
  /** 新任务状态。 */
  status?: ShipTaskStatus;
  /** 新任务正文。 */
  body?: string;
  /** 是否清空正文。 */
  clearBody?: boolean;
};

export type TaskUpdateResponse = {
  success: boolean;
  title?: string;
  taskMdPath?: string;
  error?: string;
};

export type TaskListItemView = {
  /** 任务名称。 */
  title: string;
  /** 任务描述。 */
  description: string;
  /** 任务正文。 */
  body?: string;
  /** 触发条件。 */
  when: string;
  /** 任务状态。 */
  status: string;
  /** 当前是否正在执行。 */
  running?: boolean;
  /** 任务会话标识。 */
  session_id: string;
  /** 任务执行类型。 */
  kind?: ShipTaskKind;
  /** 是否启用 review 多轮复核。 */
  review?: boolean;
  /** 任务定义文件相对路径。 */
  taskMdPath: string;
  /** 最近一次运行时间戳。 */
  lastRunTimestamp?: string;
};

export type TaskListResponse = {
  success: true;
  tasks: TaskListItemView[];
};

export type TaskRunRequest = {
  title: string;
  reason?: string;
};

export type TaskRunResponse = {
  success: boolean;
  /** 是否已受理后台执行（true 表示任务已开始异步执行） */
  accepted?: boolean;
  /** 给调用方的简短提示（例如“任务已开始，完成后 task 会自动发送给用户，请直接继续后续流程，无需等待完成”） */
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
  success: boolean;
  title?: string;
  status?: ShipTaskStatus;
  error?: string;
};

export type TaskDeleteRequest = {
  title: string;
};

export type TaskDeleteResponse = {
  success: boolean;
  title?: string;
  taskDirPath?: string;
  error?: string;
};
