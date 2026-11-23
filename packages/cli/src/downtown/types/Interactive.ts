/**
 * 交互式 Downtown CLI 的流程类型定义。
 *
 * 关键说明（中文）
 * - `downtown` 只负责 Downtown 管理。
 */

/**
 * Downtown 仪表盘可执行动作。
 */
export type DowntownAction =
  | `open_downtown:${string}`
  | "add_downtown"
  | "create_downtown"
  | "deploy_downtown"
  | "more"
  | "quit";
