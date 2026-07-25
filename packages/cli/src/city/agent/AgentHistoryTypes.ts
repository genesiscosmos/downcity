/**
 * Agent 历史维护命令类型。
 *
 * 关键点（中文）
 * - 只描述 CLI 输入与清理结果。
 * - 具体文件删除逻辑放在 AgentHistory 模块。
 */

export interface AgentHistoryCleanOptions {
  session_id?: string;
  channel?: string;
  chatId?: string;
  targetType?: string;
  threadId?: string;
  hard?: boolean;
  json?: boolean;
}

export interface AgentHistoryCleanResult {
  project_root: string;
  session_id: string;
  removedSessionDir: boolean;
  removedChatDir: boolean;
  removedRoute: boolean;
}
