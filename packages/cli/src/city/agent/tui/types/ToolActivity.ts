/**
 * Chat TUI Tool Call 展示类型。
 *
 * Tool Call 只是 Assistant Message 的子视图；这些类型只描述展示投影，
 * 不定义独立的 Transcript 身份或第二套生命周期状态。
 */

/** Tool Activity 使用的语义颜色。 */
export type ToolActivityTone = "active" | "waiting" | "success" | "error";

/** Tool Call 中一项经过筛选的基础输入信息。 */
export interface ToolActivityField {
  /** 输入字段的稳定、用户可读名称。 */
  label: string;
  /** 输入字段经过单行化后的展示值。 */
  value: string;
}

/** canonical Tool Part 投影出的 Tool Call 展示信息。 */
export interface ToolActivityPresentation {
  /** Tool 的原始注册名称，例如 shell_exec。 */
  tool_name: string;
  /** 当前 canonical 状态的用户可读名称。 */
  state_label: string;
  /** 当前状态使用的语义颜色。 */
  tone: ToolActivityTone;
  /** 经过 Tool 白名单筛选的基础调用输入，永远不包含 output。 */
  fields: ToolActivityField[];
}
