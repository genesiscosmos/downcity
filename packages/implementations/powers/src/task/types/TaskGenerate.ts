/** 所有入口共用的任务生成协议；生成保存方案，不授权实际执行。 */
import type { TaskWorkspaceItem } from "./TaskWorkflow.js";

export interface TaskGenerateInput {
  /** 用户原文或对已有方案的补充；重试已有任务时可省略。 */
  text?: string;
  /** 调整或重试的稳定任务身份；省略时生成新任务。 */
  task_id?: string;
  /** 新提交的客户端 UUID，响应不确定时复用。 */
  submission_id?: string;
  /** 用户通过候选明确指定的执行者，不等同于接待 Agent。 */
  agent_id?: string;
  /** 用户时区，缺省由入口上下文补齐。 */
  timezone?: string;
  /** 日历带入的计划时刻，不代表执行授权。 */
  planned_at?: string;
  /** 明确的外壳约束，省略时由生成结果建议。 */
  shell_type?: "todo" | "schedule";
  /** 当前入口是否已整理，缺省为 true。 */
  organized?: boolean;
}

export interface TaskGenerateResult {
  /** 已保存的任务身份，生成失败也保留此身份供重试。 */
  task_id: string;
  /** 当前任务完整信息，包含方案版本、状态与生成错误。 */
  task: TaskWorkspaceItem;
}
