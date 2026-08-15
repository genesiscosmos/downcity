/** Downcity Desktop Renderer 的页面和交互状态类型。 */

import type { RespondSessionInteractionInput, SessionMessage } from "@downcity/agent";
import type {
  DesktopAgentSummary,
  DesktopAccountResources,
  DesktopAccountSummary,
  DesktopChatFileInput,
  DesktopChatInput,
  DesktopChatRuntime,
  DesktopModelSummary,
  DesktopPluginSummary,
  DesktopSessionConfiguration,
  DesktopSessionSummary,
  DesktopSettings,
  DesktopUserSummary,
  DesktopWorkspaceSummary,
} from "../../common/types/DesktopApi";

/** 设置主视图当前展示的分区。 */
export type SettingsSection = "user" | "models" | "general" | "appearance" | "chat";

/** 主导航侧边栏当前展示的业务集合。 */
export type SidebarMode = "chat" | "agents" | "plugins";

/** 中间主视图当前展示的业务对象。 */
export type NavigationTarget =
  | { /** Workspace 管理页。 */ kind: "workspace"; /** Workspace 标识。 */ workspace_id: string }
  | { /** Agent 管理页。 */ kind: "agent"; /** Agent 标识。 */ agent_id: string }
  | { /** 尚未持久化的空对话。 */ kind: "draft"; /** Agent 标识。 */ agent_id: string; /** Draft 稳定标识。 */ draft_id: string }
  | { /** Session Chat。 */ kind: "session"; /** Agent 标识。 */ agent_id: string; /** Session 标识。 */ session_id: string }
  | { /** Plugin 详情页。 */ kind: "plugin"; /** Plugin 标识。 */ plugin_name: string }
  | { /** Desktop 设置页。 */ kind: "settings"; /** 当前设置分区。 */ section: SettingsSection };

/** 创建 Agent 表单的可序列化值。 */
export interface CreateAgentFormValue {
  /** 新 Agent 的全局标识。 */
  agent_id: string;
  /** 同时登记为独立记录的 Workspace 绝对路径。 */
  workspace_path: string;
  /** Agent 使用的 City AIService 模型标识。 */
  model_id: string;
}

/** 创建 Workspace 表单的可序列化值。 */
export interface CreateWorkspaceFormValue {
  /** Workspace 指向的绝对目录。 */
  workspace_path: string;
  /** Workspace 的用户可见名称。 */
  name: string;
}

/** Renderer 队列中的一条待发送消息。 */
export interface QueuedChatMessage {
  /** 队列项稳定标识。 */
  message_id: string;
  /** 待发送的完整用户输入。 */
  input: DesktopChatInput;
  /** 队列项创建时间戳。 */
  created_at: number;
  /** 当前队列项是否正在提交。 */
  sending: boolean;
}

/** Session 更早历史的分页状态。 */
export interface ChatHistoryState {
  /** 当前是否正在读取更早 Segment。 */
  loading: boolean;
  /** 当前结果之前是否仍有历史。 */
  has_more: boolean;
  /** 继续向前读取使用的 sequence 游标。 */
  next_before_sequence?: number;
}

/** Renderer 根状态控制器向视图公开的能力。 */
export interface DesktopViewController {
  /** 共享 Registry 中的全部 Agent。 */
  agents: DesktopAgentSummary[];
  /** 共享 Registry 中独立登记的全部 Workspace。 */
  workspaces: DesktopWorkspaceSummary[];
  /** 按 Agent 标识缓存的 Session 导航数据。 */
  sessions_by_agent: Record<string, DesktopSessionSummary[]>;
  /** 按 Agent 标识缓存的已归档 Session。 */
  archived_sessions_by_agent: Record<string, DesktopSessionSummary[]>;
  /** 按 Agent 与 Session 组合键缓存的 canonical 消息。 */
  messages_by_session: Record<string, SessionMessage[]>;
  /** 按 Session 组合键缓存的实时运行态。 */
  chat_runtime_by_session: Record<string, DesktopChatRuntime>;
  /** 按 Session 组合键隔离的输入草稿。 */
  drafts_by_session: Record<string, string>;
  /** 按 Session 组合键隔离的附件草稿。 */
  draft_files_by_session: Record<string, DesktopChatFileInput[]>;
  /** 按 Session 组合键隔离的待发送队列。 */
  queued_messages_by_session: Record<string, QueuedChatMessage[]>;
  /** 按 Session 组合键保存的历史分页状态。 */
  history_by_session: Record<string, ChatHistoryState>;
  /** 当前 Federation 中可用于对话的模型。 */
  models: DesktopModelSummary[];
  /** Desktop 当前可用的官方与第三方 Plugin。 */
  plugins: DesktopPluginSummary[];
  /** 按 Session 组合键缓存的模型与审批配置。 */
  configuration_by_session: Record<string, DesktopSessionConfiguration>;
  /** 模型目录是否正在读取。 */
  models_loading: boolean;
  /** 当前主视图导航目标。 */
  selection: NavigationTarget | null;
  /** Chat Sidebar 当前打开的 Workspace。 */
  active_workspace_id: string;
  /** 主导航侧边栏当前模式。 */
  sidebar_mode: SidebarMode;
  /** Desktop 用户级偏好。 */
  settings: DesktopSettings;
  /** 当前 Federation 用户。 */
  user: DesktopUserSummary;
  /** 当前 Desktop 保存的全部账户。 */
  accounts: DesktopAccountSummary[];
  /** 当前账户 Credits 与用量。 */
  account_resources?: DesktopAccountResources;
  /** 当前用户可见的全局错误。 */
  error: string;
  /** Registry 首次加载是否仍在进行。 */
  loading: boolean;
  /** 选择 Agent 管理页。 */
  select_agent(agent_id: string): void;
  /** 选择 Plugin 详情页。 */
  select_plugin(plugin_name: string): void;
  /** 切换主导航侧边栏集合。 */
  set_sidebar_mode(mode: SidebarMode): void;
  /** 打开一个 Workspace，并将其设为 Chat 上下文。 */
  select_workspace(workspace_id: string): void;
  /** 打开设置分区。 */
  open_settings(section?: SettingsSection): void;
  /** 离开设置并返回之前的业务视图。 */
  close_settings(): void;
  /** 切换到尚未持久化的空对话。 */
  create_session(agent_id: string): Promise<void>;
  /** 切换到 Session Chat 并读取快照。 */
  select_session(agent_id: string, session_id: string): Promise<void>;
  /** 重命名一个 Session。 */
  rename_session(agent_id: string, session_id: string, title: string): Promise<void>;
  /** 归档一个 Session。 */
  archive_session(agent_id: string, session_id: string): Promise<void>;
  /** 永久删除一个 Session。 */
  remove_session(agent_id: string, session_id: string): Promise<void>;
  /** 读取并缓存一个 Agent 的已归档 Session。 */
  load_archived_sessions(agent_id: string): Promise<void>;
  /** 读取当前 Session 的一个更早历史 Segment。 */
  load_earlier_history(agent_id: string, session_id: string): Promise<void>;
  /** 创建共享 Registry Agent。 */
  create_agent(value: CreateAgentFormValue): Promise<void>;
  /** 独立登记并打开 Workspace。 */
  create_workspace(value: CreateWorkspaceFormValue): Promise<void>;
  /** 修改 Session 输入草稿。 */
  update_draft(agent_id: string, session_id: string, text: string): void;
  /** 替换当前输入的附件草稿。 */
  update_draft_files(agent_id: string, session_id: string, files: DesktopChatFileInput[]): void;
  /** 发送消息；执行中时自动进入 Renderer 队列。 */
  send_message(agent_id: string, session_id: string, input: DesktopChatInput): Promise<void>;
  /** 刷新当前 Federation 模型目录。 */
  refresh_models(): Promise<void>;
  /** 为 Draft 或已存在 Session 选择模型。 */
  set_session_model(agent_id: string, session_id: string, model_id: string): Promise<void>;
  /** 为 Draft 或已存在 Session 选择审批模式。 */
  set_session_approval_mode(agent_id: string, session_id: string, approval_mode: DesktopSessionConfiguration["approval_mode"]): Promise<void>;
  /** 停止当前 Session Turn。 */
  stop_session(agent_id: string, session_id: string): Promise<void>;
  /** 响应当前 Session 的审批或问题。 */
  respond_interaction(agent_id: string, session_id: string, input: RespondSessionInteractionInput): Promise<void>;
  /** 删除一条尚未发送的队列消息。 */
  remove_queued_message(agent_id: string, session_id: string, message_id: string): void;
  /** 调整一条队列消息的顺序。 */
  move_queued_message(agent_id: string, session_id: string, message_id: string, direction: "up" | "down"): void;
  /** 合并 Desktop 用户级设置。 */
  update_settings(patch: Partial<DesktopSettings>): Promise<void>;
  /** 使用 Federation Token 登录。 */
  login(federation_url: string, user_token: string): Promise<void>;
  /** 退出当前 Federation 用户。 */
  logout(): Promise<void>;
  /** 切换已保存账户。 */
  switch_account(account_id: string): Promise<void>;
  /** 移除已保存账户。 */
  remove_account(account_id: string): Promise<void>;
  /** 清除当前用户可见错误。 */
  clear_error(): void;
}

/** 生成不会因不同 Agent 下同名 Session 冲突的缓存键。 */
export function get_session_key(agent_id: string, session_id: string): string {
  return `${agent_id}:${session_id}`;
}

/** 生成一个 Agent 唯一的本地 Draft Chat 标识。 */
export function get_draft_session_id(agent_id: string): string {
  return `draft:${agent_id}`;
}

/** 判断当前标识是否属于尚未持久化的 Draft Chat。 */
export function is_draft_session_id(session_id: string): boolean {
  return session_id.startsWith("draft:");
}

/** 判断运行态是否仍占用当前 Session 执行槽。 */
export function is_chat_busy(runtime?: DesktopChatRuntime): boolean {
  return runtime?.status === "submitted"
    || runtime?.status === "streaming"
    || runtime?.status === "waiting_input";
}
