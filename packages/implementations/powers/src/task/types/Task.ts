/**
 * Task 领域类型：一个任务的定义、状态与运行记录。
 *
 * ## 三条正交的轴
 *
 * 任务有三个**互相独立**的问题，混在一起是过去的主要复杂度来源：
 *
 * | 轴 | 字段 | 回答 |
 * | --- | --- | --- |
 * | 触发 | `when` | 什么时候发生（不循环 / 某一刻 / 循环） |
 * | 执行 | `kind` | 谁来做（user / agent / script） |
 * | 进度 | `progress` | 做到哪一步了 |
 *
 * 「待办 / 日常」不单独存字段：它由 `when` 是否循环**派生**（见 `task_is_recurring`）。
 * 曾经有一个 `shell_type` 字段表达它，但它与 `when` 是双向强制的等价关系，
 * 于是所有写入路径都要记得同步两份事实——历史任务里就出现了只写了一份的记录。
 *
 * ## 定义与状态在同一个文件
 *
 * `task.toml` 同时承载定义与状态，两者在一个事务里原子提交：跨文件写入没有
 * 事务保证，拆开会在中途失败时留下「定义已更新、状态没跟上」的窗口。
 * 唯一独立存放的是每次执行的产物（`runs/`），因为它是只追加的历史。
 */

import type { PowerJsonValue } from "@downcity/city/power";
import type { TaskPreparation } from "./TaskPreparation.js";
import type { TaskProgress, TaskState } from "./TaskWorkflow.js";

/**
 * 调度启停。
 *
 * 它只回答「以后还自动触发吗」，**不表示工作是否完成**：暂停一个循环任务
 * 不会让它变成已完成。工作进度在 `TaskProgress`。
 */
export type TaskScheduleStatus = "enabled" | "paused";

/**
 * 谁执行这个任务。
 *
 * - `user`：用户自己完成，不进 Agent 运行层（原 `self`）
 * - `agent`：交给绑定的 Agent 与 Workspace 执行
 * - `script`：直接执行任务正文里的脚本
 */
export type TaskKind = "user" | "agent" | "script";

/** Task 完成结果的固定 Session 交付目标。 */
export interface TaskDeliverySession {
  /** 保证该值对象可以安全进入 Power JSON 协议。 */
  [key: string]: PowerJsonValue;

  /** 持有目标 Session 的 Agent 稳定标识。 */
  agent_id: string;

  /** 目标 Session 创建时绑定的 Workspace 稳定标识；无项目会话时为 null。 */
  workspace_id: string | null;

  /** 目标 Agent Session 的稳定标识。 */
  session_id: string;

  /** 目标 Agent Session 的来源分区；允许任意非空字符串。 */
  category: string;
}

/**
 * 一个任务的完整定义与状态。
 *
 * 字段顺序即 `task.toml` 的书写顺序：先是身份与安排，再是执行目标，最后是正文。
 * 人打开文件时先看到「这是什么、什么时候、谁做」，正文在最下面。
 */
export interface TaskDefinitionV1 {
  /** 稳定任务标识（目录名 `task_<uuid>`）；标题可改可重复，身份不变。 */
  taskId: string;

  /** 用户可见名称；可重命名、可重复。 */
  title: string;

  /**
   * 触发条件，三种形态：
   *
   * - `@manual`：不自动触发
   * - `time:<ISO8601-with-timezone>`：某一时刻触发一次
   * - cron 表达式：按规则循环
   *
   * 「日常 / 待办」由此派生，不另存字段。
   */
  when: string;

  /** 谁执行这个任务。 */
  kind: TaskKind;

  /** `kind=agent` 时绑定的执行 Agent；其他类型为空串。 */
  agent_id: string;

  /** `kind=agent` 时绑定的执行 Workspace；其他类型为空串。 */
  workspace_id: string;

  /** 创建时捕获的结果交付 Session；未指定时为空。 */
  delivery_session?: TaskDeliverySession;

  /** 是否多轮复核（仅 `kind=agent` 生效；默认单轮）。 */
  review?: boolean;

  /** 用户提交的**原文**，永不被子模型生成的内容覆盖。 */
  source?: string;

  /** 首次录入的提交身份；重试同一提交时复用它以保证幂等。 */
  submission_id?: string;

  /** 用户用 `@` 明确指定的 Agent，优先于模型建议。 */
  source_agent_id?: string;

  /**
   * 整理进度；**仅整理进行中存在**。
   *
   * 整理完成后整个字段消失：`analyzed_body` 就是 `body`，`questions` 已清空，
   * 保留一份过程数据的副本只会让人分不清哪个是事实。
   */
  preparing?: TaskPreparation;

  /** 执行说明，可直接作为 Agent 的 prompt。 */
  body: string;

  /** 工作管理属性：进度、时区、计划与截止时间。 */
  workflow: TaskState;

  /**
   * 调度启停。
   *
   * 独立于 `workflow.progress`：暂停循环不等于工作完成。
   */
  schedule: TaskScheduleStatus;

  /** 相对存储根目录的 `task.toml` 路径。 */
  taskPath: string;
}

/** 兼容别名；领域内部统一使用 `TaskDefinitionV1`。 */
export type ShipTaskDefinitionV1 = TaskDefinitionV1;

/** 触发来源。 */
export type ShipTaskRunTriggerV1 =
  | { type: "cron" }
  | { type: "time" }
  | { type: "manual"; reason?: string };

/** 一次执行记录的类型别名；与 `TaskProgress` 同源。 */
export type TaskWorkStatus = TaskProgress;

export type ShipTaskStatus = TaskScheduleStatus;
export type ShipTaskKind = TaskKind;

export type ShipTaskRunStatusV1 = "success" | "failure" | "skipped";
export type ShipTaskRunExecutionStatusV1 = "success" | "failure" | "skipped";
export type ShipTaskRunResultStatusV1 = "valid" | "invalid" | "not_checked";
export type ShipTaskRunProgressStatusV1 = "running" | "success" | "failure";

/**
 * 执行进度阶段（用于实时展示）。
 */
export type ShipTaskRunProgressPhaseV1 =
  | "preparing"
  | "script_running"
  | "agent_executor_round"
  | "agent_user_simulator_round"
  | "validating"
  | "writing_artifacts"
  | "completed";

/**
 * 单条进度事件。
 */
export type ShipTaskRunProgressEventV1 = {
  /** 事件时间（ms） */
  at: number;
  /** 当前阶段 */
  phase: ShipTaskRunProgressPhaseV1;
  /** 阶段说明 */
  message: string;
  /** 当前轮次（agent 场景可选） */
  round?: number;
  /** 最大轮次（agent 场景可选） */
  maxRounds?: number;
};

/**
 * 运行中进度快照（run-progress.json）。
 */
export type ShipTaskRunProgressV1 = {
  /** schema 版本 */
  v: 1;
  /** taskId */
  taskId: string;
  /** run 时间戳目录名 */
  timestamp: string;
  /** 本次执行唯一 ID。 */
  execution_id: string;
  /** 触发来源 */
  trigger: ShipTaskRunTriggerV1;
  /** 任务类型 */
  kind: TaskKind;
  /** 当前进度状态 */
  status: ShipTaskRunProgressStatusV1;
  /** 当前阶段 */
  phase: ShipTaskRunProgressPhaseV1;
  /** 当前阶段说明 */
  message: string;
  /** 开始时间（ms） */
  startedAt: number;
  /** 最近更新时间（ms） */
  updated_at: number;
  /** 结束时间（ms，完成后可选） */
  endedAt?: number;
  /** 最终 run 状态（完成后可选） */
  runStatus?: ShipTaskRunStatusV1;
  /** 最终执行状态（完成后可选） */
  executionStatus?: ShipTaskRunExecutionStatusV1;
  /** 最终结果校验状态（完成后可选） */
  resultStatus?: ShipTaskRunResultStatusV1;
  /** 当前轮次（agent 场景可选） */
  round?: number;
  /** 最大轮次（agent 场景可选） */
  maxRounds?: number;
  /** 最近进度事件（仅保留有限窗口） */
  events: ShipTaskRunProgressEventV1[];
};

export type ShipTaskRunMetaV1 = {
  /** schema 版本 */
  v: 1;
  /** 任务 ID */
  taskId: string;
  /** 本次 run 时间戳（目录名） */
  timestamp: string;
  /** 本次执行唯一 ID */
  executionId: string;
  /** 本次执行使用的 Agent ID。 */
  agent_id: string;
  /** 本次执行使用的 Workspace ID。 */
  workspace_id: string;
  /** 本次运行使用的固定结果交付 Session。 */
  delivery_session?: TaskDeliverySession;
  /** 触发来源 */
  trigger: ShipTaskRunTriggerV1;
  /** 最终状态（综合执行阶段 + 结果校验） */
  status: ShipTaskRunStatusV1;
  /** 执行阶段状态（agent run 是否成功） */
  executionStatus: ShipTaskRunExecutionStatusV1;
  /** 结果校验状态（产物/输出是否满足要求） */
  resultStatus: ShipTaskRunResultStatusV1;
  /** 结果校验错误摘要（可选） */
  resultErrors?: string[];
  /** 实际执行的双边对话轮数 */
  dialogueRounds: number;
  /** 模拟用户在最终轮是否判定“满意” */
  userSimulatorSatisfied: boolean;
  /** 模拟用户的最终回复（可选） */
  userSimulatorReply?: string;
  /** 模拟用户的最终理由（可选） */
  userSimulatorReason?: string;
  /** 模拟用户的最终评分（0-10，可选） */
  userSimulatorScore?: number;
  /** 开始时间（ms） */
  startedAt: number;
  /** 结束时间（ms） */
  endedAt: number;
  /** 失败摘要（可选） */
  error?: string;
};
