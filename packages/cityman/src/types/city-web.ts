/** City Web 前端与本地控制面之间的稳定数据协议。 */

/** City 全局 Agent 的展示状态。 */
export interface CityWebAgent {
  /** City 全局数据库中的 Agent 稳定标识。 */
  agent_id: string;
  /** Agent 绑定的 Workspace 绝对路径。 */
  workspace_path: string;
  /** 当前 daemon 是否运行。 */
  status: "running" | "stopped";
}

/** City Agent Session 的历史摘要。 */
export interface CityWebSession {
  /** Session 稳定标识。 */
  session_id: string;
  /** Session 展示标题。 */
  title?: string;
  /** 最近一条消息预览。 */
  preview_text?: string;
  /** 消息数量。 */
  message_count: number;
  /** 最近更新时间。 */
  updated_at?: number;
  /** 是否正在执行。 */
  executing?: boolean;
}

/** Agent 操作中的对话运行状态。 */
export type CityWebChatStatus = "ready" | "submitted" | "streaming" | "error";

