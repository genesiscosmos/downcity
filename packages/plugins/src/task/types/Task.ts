/**
 * Task System domain 类型。
 *
 * 关键点（中文）
 * - task 定义使用 markdown + frontmatter
 * - 每次执行产出 run 目录用于审计
 */

export type ShipTaskStatus = "enabled" | "paused" | "disabled";
export type ShipTaskKind = "agent" | "script";

export type ShipTaskFrontmatterV1 = {
  /** 任务名称（唯一语义标识；对外统一使用 title） */
  title: string;
  /** 触发条件：`@manual`、cron 表达式，或 `time:<ISO8601-with-timezone>` */
  when: string;
  /** 任务描述（给执行器的意图说明） */
  description: string;
  /** 任务执行会话标识（session_id） */
  session_id: string;
  /** 任务执行类型（agent=交给 agent 执行；script=直接执行 task 正文脚本） */
  kind?: ShipTaskKind;
  /** 是否启用 review 多轮复核（仅 `kind=agent` 生效；默认 false，false 时单轮执行） */
  review?: boolean;
  /** 启停状态 */
  status: ShipTaskStatus;
};

export type ShipTaskDefinitionV1 = {
  /** schema 版本 */
  v: 1;
  /** 稳定任务键（与 title 同值，用于目录与运行上下文） */
  taskId: string;
  /** task.md frontmatter */
  frontmatter: ShipTaskFrontmatterV1;
  /** 任务正文（可直接作为执行 prompt） */
  body: string;
  /** 相对项目根目录的 task.md 路径 */
  taskMdPath: string;
};

export type ShipTaskRunTriggerV1 =
  | { type: "cron" }
  | { type: "time" }
  | { type: "manual"; reason?: string };

export type ShipTaskRunStatusV1 = "success" | "failure" | "skipped";
export type ShipTaskRunExecutionStatusV1 = "success" | "failure" | "skipped";
export type ShipTaskRunResultStatusV1 = "valid" | "invalid" | "not_checked";
export type ShipTaskRunProgressStatusV1 = "running" | "success" | "failure";

/**
 * 执行进度阶段（用于 Console 实时展示）。
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
  /** 触发来源 */
  trigger: ShipTaskRunTriggerV1;
  /** 任务类型 */
  kind: ShipTaskKind;
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
  /** 任务执行会话标识 */
  session_id: string;
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
