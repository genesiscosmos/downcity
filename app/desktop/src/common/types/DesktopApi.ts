/**
 * Downcity Desktop 的 Renderer IPC 类型。
 *
 * 这些类型只描述安全桥接边界，不暴露 Electron、SQLite 或 Agent SDK 实例。
 */

/** Renderer 可见的 Agent 摘要。 */
export interface DesktopAgentSummary {
  /** Agent 的全局稳定标识。 */
  agent_id: string;
  /** Agent 持久化绑定的 Workspace ID。 */
  workspace_id: string;
  /** Agent 使用的 City AIService 模型标识。 */
  model_id: string;
  /** Agent 注册配置的结构版本。 */
  version: string;
}

/** Renderer 可见的独立 Workspace 摘要。 */
export interface DesktopWorkspaceSummary {
  /** Workspace 的稳定 Registry ID。 */
  workspace_id: string;
  /** Workspace 当前指向的绝对路径。 */
  workspace_path: string;
  /** Workspace 用户可见名称。 */
  name: string;
}

/** Desktop main 中一个 native Agent 的当前运行目标。 */
export interface DesktopAgentRuntime {
  /** 当前运行 Agent ID。 */
  agent_id: string;
  /** 当前 Agent 持久化绑定的 Workspace。 */
  workspace: DesktopWorkspaceSummary;
}

/** 创建 Agent 便捷工作流的结果。 */
export interface DesktopCreateAgentResult {
  /** 新创建的独立 Agent 记录。 */
  agent: DesktopAgentSummary;
  /** 同时登记的独立 Workspace 记录。 */
  workspace: DesktopWorkspaceSummary;
}

/** Renderer 可见的 Session 摘要。 */
export interface DesktopSessionSummary {
  /** Session 的稳定标识。 */
  session_id: string;
  /** Session 的可见标题。 */
  title: string;
}

/** Renderer 可直接展示的一条 Session 消息。 */
export interface DesktopChatMessage {
  /** 消息在 Session 内的稳定标识。 */
  message_id: string;
  /** 消息的展示角色。 */
  role: "user" | "assistant" | "system" | "error";
  /** 已经归一化的纯文本内容。 */
  text: string;
  /** 消息创建时间戳，单位为毫秒。 */
  created_at: number;
  /** 消息是否仍在处理中。 */
  pending: boolean;
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
    create(agent_id: string, workspace_path: string, model_id: string): Promise<DesktopCreateAgentResult>;
    /** 按 Agent 持久化绑定的 Workspace 创建 Desktop native Agent。 */
    connect(agent_id: string): Promise<DesktopAgentRuntime>;
  };
  /** 独立 Workspace Registry 能力。 */
  workspace: {
    /** 列出全部已登记 Workspace。 */
    list(): Promise<DesktopWorkspaceSummary[]>;
  };
  /** Agent Session 与聊天能力。 */
  chat: {
    /** 列出指定 Agent 的 Session。 */
    list_sessions(agent_id: string): Promise<DesktopSessionSummary[]>;
    /** 创建新的 Session。 */
    create_session(agent_id: string): Promise<DesktopSessionSummary>;
    /** 读取指定 Session 当前可见的消息快照。 */
    list_messages(agent_id: string, session_id: string): Promise<DesktopChatMessage[]>;
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
