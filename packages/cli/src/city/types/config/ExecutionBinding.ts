/**
 * CLI/City 项目执行绑定类型定义（api 模式）。
 *
 * 关键点（中文）
 * - 项目运行入口只有一种执行模式：`api`。
 * - 绑定 City AIService 暴露的模型 ID。
 * - 该类型是 Agent 全局配置中的执行绑定结构。
 */

/**
 * 项目执行绑定配置（api 模式）。
 */
export interface ExecutionBindingConfig {
  /**
   * 执行模式类型，固定为 `api`。
   */
  type: "api";

  /**
   * City AIService 中的模型 ID。
   *
   * 说明（中文）
   * - 必须能通过 City 的 `/v1/ai/models` 目录查询到。
   * - 例如：`deepseek-v4-flash`、`fast`、`quality`。
   */
  model_id: string;
}
