/**
 * Task plugin runtime 类型定义。
 *
 * 关键点（中文）
 * - 这里集中声明 task plugin runtime 在类化拆分后共享的 action payload 与调度结果类型。
 * - 跨模块复用的 task plugin runtime 类型统一收敛在 `plugins/task/types/`。
 */

import type { ShipTaskStatus } from "@/task/types/Task.js";

/**
 * `task.list` action 的输入载荷。
 */
export type TaskListActionPayload = {
  /**
   * 按任务状态过滤；省略时返回全部状态。
   */
  status?: ShipTaskStatus;
};

/**
 * task cron runtime 启动或重载后的统计结果。
 */
export type TaskCronRegisterResult = {
  /**
   * 本次扫描到的任务定义数量。
   */
  tasksFound: number;
  /**
   * 本次成功注册到 cron engine 的作业数量。
   */
  jobsScheduled: number;
};

/**
 * 任务定义变更后 scheduler 重载结果。
 */
export type TaskSchedulerReloadResult = {
  /**
   * scheduler 是否成功完成重载。
   */
  reloaded: boolean;
  /**
   * 成功重载时扫描到的任务数量。
   */
  tasksFound?: number;
  /**
   * 成功重载时注册成功的 cron 作业数量。
   */
  jobsScheduled?: number;
  /**
   * 重载失败时的错误文本。
   */
  error?: string;
};
