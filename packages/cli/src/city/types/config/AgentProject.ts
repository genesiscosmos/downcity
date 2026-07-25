/**
 * Agent 项目初始化相关类型定义。
 *
 * 关键点（中文）
 * - 统一承载 CLI 与 control plane 共用的初始化输入/输出结构。
 * - 所有字段都面向"项目骨架创建"语义，不掺杂 runtime 状态。
 */

import type { ExecutionBindingConfig } from "@/city/types/config/ExecutionBinding.js";

/**
 * 可选的 chat channel 标识。
 */
export type AgentProjectChannel = "telegram" | "feishu" | "qq";

/**
 * 初始化 agent 项目的输入参数。
 */
export interface AgentProjectInitializationInput {
  /**
   * agent 项目根目录（绝对路径或可解析相对路径）。
   */
  project_root: string;

  /**
   * agent 唯一标识。
   *
   * 关键点（中文）
   * - 为空时会自动回退到目录名推导出的默认 id。
   * - CLI 可把该字段写入自己的全局配置存储。
   */
  id?: string;

  /**
   * 项目执行绑定配置。
   *
   * 说明（中文）
   * - 绑定 City AIService 暴露的模型 ID。
   */
  execution: ExecutionBindingConfig;

  /**
   * 需要启用的 chat channels。
   *
   * 关键点（中文）
   * - SDK 初始化器只返回选择结果，不负责配置持久化。
   */
  channels?: AgentProjectChannel[];

}

/**
 * 初始化完成后的摘要结果。
 */
export interface AgentProjectInitializationResult {
  /**
   * 已解析后的 agent 项目根目录（绝对路径）。
   */
  project_root: string;

  /**
   * 最终写入的 agent id。
   */
  id: string;

  /**
   * 最终启用的 chat channels。
   */
  channels: AgentProjectChannel[];

  /**
   * 最终选择的 City AIService 模型 ID。
   */
  model_id?: string;

  /**
   * 本次实际创建/写入的文件列表。
   */
  created_files: string[];

  /**
   * 因已存在而跳过的文件列表。
   */
  skipped_files: string[];
}
