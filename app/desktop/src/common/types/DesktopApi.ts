/**
 * Downcity Desktop 的 Renderer IPC 类型。
 *
 * 这些类型只描述安全桥接边界，不暴露 Electron、SQLite 或 Agent SDK 实例。
 */

/** Renderer 可见的 Agent 摘要。 */
export interface DesktopAgentSummary {
  /** Agent 的全局稳定标识。 */
  agent_id: string;
  /** Agent 当前绑定的 Workspace 绝对路径。 */
  workspace_path: string;
}

/** Renderer 可见的 Session 摘要。 */
export interface DesktopSessionSummary {
  /** Session 的稳定标识。 */
  session_id: string;
  /** Session 的可见标题。 */
  title: string;
}

/** 一次聊天请求的最终结果。 */
export interface DesktopChatResult {
  /** 本次请求所属 Session ID。 */
  session_id: string;
  /** Agent 返回的最终文本。 */
  text: string;
  /** Turn 是否成功完成。 */
  success: boolean;
  /** Turn 失败时的错误信息。 */
  error?: string;
}

/** Preload 向 Renderer 暴露的最小 API。 */
export interface DesktopApi {
  /** Agent 注册和运行能力。 */
  agent: {
    /** 列出共享 Registry 中的全部 Agent。 */
    list(): Promise<DesktopAgentSummary[]>;
    /** 创建共享注册记录。 */
    create(agent_id: string, workspace_path: string, model_id: string): Promise<DesktopAgentSummary>;
    /** 启动 CLI daemon 并建立 RPC 连接。 */
    start(agent_id: string): Promise<string>;
  };
  /** Agent Session 与聊天能力。 */
  chat: {
    /** 列出指定 Agent 的 Session。 */
    list_sessions(agent_id: string): Promise<DesktopSessionSummary[]>;
    /** 创建新的 Session。 */
    create_session(agent_id: string): Promise<DesktopSessionSummary>;
    /** 向指定 Session 发送文本并等待最终结果。 */
    send(agent_id: string, session_id: string, text: string): Promise<DesktopChatResult>;
  };
}

declare global {
  interface Window {
    /** Electron Preload 暴露的 Downcity API。 */
    downcity: DesktopApi;
  }
}
