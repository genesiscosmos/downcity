/**
 * 任务的工作状态、发生历史与宿主协议。
 *
 * ## 三个状态各回答一个问题
 *
 * | 状态 | 字段 | 回答 |
 * | --- | --- | --- |
 * | 进度 | `workflow.progress` | 这件工作做到哪一步了 |
 * | 调度 | `schedule` | 以后还自动触发吗 |
 * | 执行 | Run 目录 | 某次运行成没成功 |
 *
 * 三者互不派生：暂停一个循环任务不会让它变成已完成，一次执行成功也不等于
 * 用户验收了交付结果。
 *
 * ## 工作状态与定义同文件
 *
 * `TaskState` 随 `task.toml` 一起原子提交（见 `runtime/TaskDocument.ts`），
 * 因此发生项与收件箱历史和定义永远是同一份事实。唯一独立存放的是每次执行的
 * 产物目录 `runs/`，因为它是只追加的历史。
 */

import type { ShipTaskDefinitionV1 } from "./Task.js";
import type { TaskDefinitionIssue } from "./TaskPowerTypes.js";

/** 工作的进度状态，与调度启停和单次执行结果独立。 */
export type TaskProgress =
  | "pending"
  | "in_progress"
  | "review"
  | "completed"
  | "cancelled";

/** 周期或提醒任务的一次独立发生。 */
export interface TaskOccurrence {
  /** 同一计划时间的稳定去重标识。 */
  occurrence_id: string;
  /** 本次计划的绝对时刻。 */
  planned_at: string;
  /** 本次工作的状态；skipped 表示跳过而非执行失败。 */
  status: TaskProgress | "skipped";
  /** 关联实际执行的令牌，个人提醒时为空。 */
  execution_id?: string;
  /** 关联执行产物目录的时间戳。 */
  run_timestamp?: string;
  /** 本次完成时间，未完成时为空。 */
  completed_at?: string;
}

/** 需要用户操作的任务事项。 */
export interface TaskInboxItem {
  /** 稳定事项标识，重复发布同一事件时保持不变。 */
  item_id: string;
  /** 产品可处理的事项类型，不包含无法关联原请求的审批消息。 */
  kind: "reminder" | "review" | "failure" | "missed";
  /** 面向用户的原因或摘要。 */
  message: string;
  /** 创建事项的 ISO 时间。 */
  created_at: string;
  /** 是否已实际处理；打开详情不改变此状态。 */
  resolved: boolean;
  /** 可选周期发生项标识。 */
  occurrence_id?: string;
  /** 可选执行目录时间戳，供查看对应产物。 */
  run_timestamp?: string;
  /** 用户对该交付结果提出的修订要求，保存后不自动执行。 */
  feedback?: string;
}

/** 一项任务的工作属性、周期历史与收件箱，随定义原子持久化。 */
export interface TaskState {
  /** 工作创建的 ISO 时间，用于稳定排序。 */
  created_at: string;
  /** 最近一次定义或工作状态修改的 ISO 时间。 */
  updated_at: string;
  /** 工作进度，与调度启停和执行结果独立。 */
  progress: TaskProgress;
  /** 是否已经整理；false 时显示在收件箱待整理区。 */
  organized: boolean;
  /** 可选计划开始时刻，使用带时区的 ISO 日期时间。 */
  planned_at?: string;
  /** 一次性工作的计划结束时刻，须晚于开始；不表示持续运行。 */
  planned_end_at?: string;
  /** 可选截止日期；支持 YYYY-MM-DD 或带时区的 ISO 日期时间。 */
  due_at?: string;
  /** 周期调度的 IANA 时区，不随宿主系统时区改变。 */
  timezone: string;
  /** 是否逐次人工验收；一次性 Agent 工作始终需要验收。 */
  require_acceptance: boolean;
  /** 本次活动执行的令牌，用于拒绝过期执行结果。 */
  active_execution_id?: string;
  /** 最近一次用户确认完成的 ISO 时间。 */
  completed_at?: string;
  /** 已发生或明确跳过的周期记录。 */
  occurrences: TaskOccurrence[];
  /** 与任务关联的处理事项，包含已处理历史。 */
  inbox: TaskInboxItem[];
}

/** 宿主工作区的一项任务：定义本身即事实源，运行态只补充「此刻是否在跑」。 */
export interface TaskWorkspaceItem {
  /** 完整定义（含工作状态与收件箱），所有界面共用同一事实源。 */
  definition: ShipTaskDefinitionV1;
  /** 当前实例是否持有活动执行，重启后不依赖过期令牌判断。 */
  running: boolean;
}

/** 三个任务入口共享的宿主快照。 */
export interface TaskWorkspaceSnapshot {
  /** City 中的统一任务集合。 */
  tasks: TaskWorkspaceItem[];
  /** 可选 Agent 执行目标。 */
  agents: Array<{
    /** Agent 稳定标识。 */
    agent_id: string;
    /** Agent 用户可见名称。 */
    name: string;
  }>;
  /** 可选 Workspace 执行环境。 */
  workspaces: Array<{
    /** Workspace 稳定标识。 */
    workspace_id: string;
    /** Workspace 用户可见名称。 */
    name: string;
  }>;
  /** 无法读取的定义，保持可观察而不阻塞其他任务。 */
  issues: TaskDefinitionIssue[];
}

/** 创建或替换任务编辑内容的输入；工作进度由单独命令管理。 */
export interface TaskWorkspaceSaveInput {
  /** 直接创建的客户端 UUID；网络重试复用，生成稳定身份。 */
  create_id?: string;
  /** 修改时提供稳定 ID；创建时为空。 */
  task_id?: string;
  /** 用户可重命名、可重复的非空标题。 */
  title: string;
  /** 任务目标和执行说明；个人待办允许为空。 */
  body: string;
  /** 执行方式，user 不进入 Agent 运行层。 */
  kind: "user" | "agent" | "script";
  /** 执行 Agent 标识，user 任务时为空。 */
  agent_id: string;
  /** 执行 Workspace 标识，user 任务时为空。 */
  workspace_id: string;
  /** 手动、一次性时间或 cron 触发规则。 */
  when: string;
  /** 是否启用自动触发。 */
  schedule: "enabled" | "paused";
  /** 是否已整理，快速收集时为 false。 */
  organized: boolean;
  /** 可选计划开始时间，精确日期时间含时区。 */
  planned_at?: string;
  /** 可选计划结束时间，与开始时间共同表达一次性工作时间段。 */
  planned_end_at?: string;
  /** 可选截止日期或精确时间。 */
  due_at?: string;
  /** 周期规则的 IANA 时区。 */
  timezone: string;
  /** 周期结果是否需要逐次验收。 */
  require_acceptance: boolean;
  /** 用户正在编辑的准备版本；提供时拒绝覆盖已更新的方案。 */
  expected_revision?: number;
  /** 用户是否要求保存后立即执行；仅 Agent 手动规则允许为 true。 */
  start_now?: boolean;
}
