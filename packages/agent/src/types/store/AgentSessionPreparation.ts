/** 宿主取得存储根独占所有权后，准备已有 Agent 会话库的访问协调。 */
export interface AgentSessionPreparationInput {
  /** 必须与已有 sessions.db 权威元数据一致的稳定 Agent 标识。 */
  agent_id: string;
  /** 已存在的 Agent 私有存储根绝对路径；不接受 Workspace 目录或链接。 */
  storage_root_path: string;
}
