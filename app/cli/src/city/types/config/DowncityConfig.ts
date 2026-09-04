/**
 * Downcity 配置类型定义。
 *
 * 关键点（中文）
 * - 该配置只属于 CLI/City 控制面，不进入 Agent SDK。
 * - Agent 只接收宿主已经装配好的 Workspace、Model 与 Plugin 实例。
 */
import type { LlmConfig } from "@/city/types/config/LlmConfig.js";
import type { ExecutionBindingConfig } from "@/city/types/config/ExecutionBinding.js";

export interface DowncityConfig {
  /**
   * agent 唯一标识。
   *
   * 关键点（中文）
   * - `@downcity/agent` 只关心稳定标识，不承担展示名语义。
   * - 该字段同时用于 session/runtime/storage 目录归属。
   */
  id: string;
  version: string;
  /**
   * 项目执行绑定配置。
   *
   * 关键点（中文）
   * - 项目只有一种执行模式：`api`。
   * - 绑定 City AIService 暴露的模型 ID。
   */
  execution?: ExecutionBindingConfig;
  /**
   * LLM 全量配置（通常来自平台全局层合并结果）。
   *
   * 关键点（中文）
   * - `@downcity/agent` 本地 SDK 不直接消费该字段。
   * - 宿主侧（例如 `downcity`）可读取该字段控制模型工厂行为，例如 `llm.logMessages`。
   * - 该字段通常由宿主平台装配，不由 Agent SDK 解析。
   */
  llm?: LlmConfig;
}
