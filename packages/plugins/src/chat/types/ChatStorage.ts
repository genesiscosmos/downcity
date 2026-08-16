/**
 * Chat Plugin 存储维护类型。
 *
 * 关键点（中文）
 * - 这些类型只描述 Chat Plugin 自己的持久化数据维护能力。
 * - Agent、Server 与 CLI 不需要知道 channel meta 或 chat history 的实际目录结构。
 */

/**
 * 清理单个 Chat 会话存储的输入。
 */
export interface ChatStorageCleanInput {
  /** 当前 AgentWorkspace 内部数据根目录。 */
  data_path: string;
  /** 已知的 Session 标识；提供时优先使用。 */
  session_id?: string;
  /** Chat 渠道名称；未提供 Session 标识时用于解析目标会话。 */
  channel?: string;
  /** Chat 渠道目标标识；未提供 Session 标识时用于解析目标会话。 */
  chat_id?: string;
  /** 可选的 Chat 目标类型，用于缩小路由匹配范围。 */
  target_type?: string;
  /** 可选的消息线程标识，用于缩小路由匹配范围。 */
  thread_id?: number;
}

/**
 * 清理单个 Chat 会话存储的结果。
 */
export interface ChatStorageCleanResult {
  /** 最终解析出的 Session 标识；未找到目标时为空字符串。 */
  session_id: string;
  /** 是否删除了 Chat 事件目录。 */
  removed_chat_dir: boolean;
  /** 是否从 channel meta 中删除了路由映射。 */
  removed_route: boolean;
}
