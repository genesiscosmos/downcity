/**
 * 交互式 Federation CLI 的流程类型定义。
 *
 * 关键说明（中文）
 * - `downfed` 只负责 Federation 管理。
 */

/**
 * Federation 仪表盘可执行动作。
 */
export type FederationAction =
  | `open_federation:${string}`
  | "add_federation"
  | "create_federation"
  | "deploy_federation"
  | "more"
  | "quit";
