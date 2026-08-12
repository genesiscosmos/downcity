/** Downcity Desktop Renderer 的页面状态类型。 */

import type {
  DesktopAgentSummary,
  DesktopChatMessage,
  DesktopSessionSummary,
  DesktopWorkspaceSummary,
} from "../../common/types/DesktopApi";

/** native Agent 在当前 Desktop 生命周期内的装配状态。 */
export type AgentRuntimeState = "idle" | "connecting" | "connected" | "error";

/** 中间主视图当前展示的业务对象。 */
export type NavigationTarget =
  | {
      /** 当前主视图固定为 Agent 管理页。 */
      kind: "agent";
      /** 管理页所属 Agent 标识。 */
      agent_id: string;
    }
  | {
      /** 当前主视图固定为 Session Chat。 */
      kind: "session";
      /** Session 所属 Agent 标识。 */
      agent_id: string;
      /** 当前聊天 Session 标识。 */
      session_id: string;
    };

/** 创建 Agent 表单的可序列化值。 */
export interface CreateAgentFormValue {
  /** 新 Agent 的全局标识。 */
  agent_id: string;
  /** 同时登记为独立记录的 Workspace 绝对路径。 */
  workspace_path: string;
  /** Agent 使用的 City AIService 模型标识。 */
  model_id: string;
}

/** Renderer 根状态控制器向视图公开的最小能力。 */
export interface DesktopViewController {
  /** 共享 Registry 中的全部 Agent。 */
  agents: DesktopAgentSummary[];
  /** 共享 Registry 中独立登记的全部 Workspace。 */
  workspaces: DesktopWorkspaceSummary[];
  /** 每个 Agent 当前选择的运行 Workspace ID。 */
  workspace_id_by_agent: Record<string, string>;
  /** 按 Agent 标识缓存的 Session 导航数据。 */
  sessions_by_agent: Record<string, DesktopSessionSummary[]>;
  /** 按 Agent 与 Session 组合键缓存的 Chat 消息。 */
  messages_by_session: Record<string, DesktopChatMessage[]>;
  /** 每个 Agent 在当前应用生命周期内的连接状态。 */
  runtime_by_agent: Record<string, AgentRuntimeState>;
  /** 当前中间主视图的导航目标；为空时展示欢迎页。 */
  selection: NavigationTarget | null;
  /** 当前正在发送消息的 Session 组合键。 */
  sending_session_key: string;
  /** 当前用户可见的全局错误。 */
  error: string;
  /** Registry 首次加载是否仍在进行。 */
  loading: boolean;
  /** 选择 Agent 管理页。 */
  select_agent(agent_id: string): void;
  /** 在 Desktop main 中装配 native Agent 并刷新 Session。 */
  connect_agent(agent_id: string): Promise<void>;
  /** 修改 Agent 下次连接时使用的 Workspace。 */
  select_workspace(agent_id: string, workspace_id: string): void;
  /** 创建 Session 并切换到对应 Chat。 */
  create_session(agent_id: string): Promise<void>;
  /** 切换到 Session Chat 并读取已有消息。 */
  select_session(agent_id: string, session_id: string): Promise<void>;
  /** 创建共享 Registry Agent。 */
  create_agent(value: CreateAgentFormValue): Promise<void>;
  /** 向当前 Session 发送一条纯文本消息。 */
  send_message(agent_id: string, session_id: string, text: string): Promise<void>;
  /** 清除当前用户可见错误。 */
  clear_error(): void;
}

/** 生成不会因不同 Agent 下同名 Session 冲突的缓存键。 */
export function get_session_key(agent_id: string, session_id: string): string {
  return `${agent_id}:${session_id}`;
}
