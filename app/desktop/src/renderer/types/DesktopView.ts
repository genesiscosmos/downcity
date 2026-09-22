/** Downcity Desktop Renderer 的页面和交互状态类型。 */

import type { RespondSessionInteractionInput, SessionAgentInteraction, SessionMessage, SessionTurnFileDiffSummary } from "@downcity/agent";
import type { PowerJsonObject } from "@downcity/city/power";
import type { JSONContent } from "@tiptap/core";
import type { DesktopAgentSummary, DesktopAgentDefinition, DesktopAccountResources, DesktopAccountSummary, DesktopChatRewriteInput, DesktopChatRuntime, DesktopCreateGroupInput, DesktopUpdateGroupInput, DesktopGroupMemberRuntime, DesktopGroupStatusPhase, DesktopGroupSummary, DesktopModelSummary, DesktopPowerSummary, DesktopPowerDefinition, DesktopInvokePowerActionInput, DesktopSessionConfiguration, DesktopSessionSummary, DesktopSettings, DesktopUserSummary, DesktopUpdateAgentInput, DesktopWorkspaceSummary } from "../../common/types/DesktopApi";
import type { DesktopNotificationState } from "../../common/types/DesktopNotification";
import type { GroupMessageProjection } from "./GroupProjection";
import type { ChatAttention } from "@/lib/notification/attention";

/** 设置主视图当前展示的分区。 */
export type SettingsSection = "user" | "models" | "general" | "appearance" | "chat" | "shortcuts";

/** 功能型 Power 在一级导航中的动态模式。 */
export type PowerWorkspaceSidebarMode = `power:${string}`;

/** 主导航侧边栏当前展示的业务集合。 */
export type SidebarMode = "chat" | "workspace" | "powers" | PowerWorkspaceSidebarMode;

/** 中间主视图当前展示的业务对象。 */
export type NavigationTarget =
  | { /** Agent 创建页面。 */ kind: "create_agent" }
  | { /** Group 创建页面。 */ kind: "create_group" }
  | { /** Power 工作区列表。 */ kind: "powers" }
  | { /** Workspace 管理页。 */ kind: "workspace"; /** Workspace 标识。 */ workspace_id: string }
  | { /** Workspace 文件只读预览。 */ kind: "workspace_file"; /** Workspace 标识。 */ workspace_id: string; /** Workspace 内的相对文件路径。 */ relative_path: string; /** 预览需要滚动并高亮的 1 基行号；未指定时按文件开头展示。 */ line?: number }
  | { /** Agent 管理页。 */ kind: "agent"; /** Agent 标识。 */ agent_id: string }
  | { /** 尚未持久化的空对话。 */ kind: "draft"; /** Workspace 标识。 */ workspace_id: string; /** Agent 标识。 */ agent_id: string; /** Draft 稳定标识。 */ draft_id: string }
  | { /** Session Chat。 */ kind: "session"; /** Workspace 标识。 */ workspace_id: string; /** Agent 标识。 */ agent_id: string; /** Session 标识。 */ session_id: string }
  | { /** 尚未持久化的 Group 空对话。 */ kind: "group_draft"; /** Group 标识。 */ group_id: string; /** Workspace 标识。 */ workspace_id: string; /** Draft 稳定标识。 */ draft_id: string }
  | { /** 具体 GroupSession Chat。 */ kind: "group_session"; /** Group 标识。 */ group_id: string; /** Workspace 标识。 */ workspace_id: string; /** GroupSession 标识。 */ session_id: string }
  | { /** Group 配置页。 */ kind: "group"; /** Group 标识。 */ group_id: string }
  | { /** Power 详情页。 */ kind: "power"; /** Power 标识。 */ power_id: string }
  | { /** Power 独立功能工作区。 */ kind: "power_workspace"; /** Power 标识。 */ power_id: string }
  | { /** Desktop 设置页。 */ kind: "settings"; /** 当前设置分区。 */ section: SettingsSection };

/** 创建 Agent 表单的可序列化值。 */
export interface CreateAgentFormValue {
  /** Agent 的用户可见名称。 */
  name: string;
  /** Agent 对外展示的身份简介。 */
  description: string;
  /** 写入 SOUL.md 的 Agent 主体指令。 */
  instruction: string;
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
  input: JSONContent;
  /** 队列项创建时间戳。 */
  created_at: number;
  /** 当前队列项是否正在提交。 */
  sending: boolean;
  /** 是否暂停自动发送；暂停项只在用户显式操作后提交。 */
  paused: boolean;
}

/** Chat 输入的提交意图：常规发送、显式排队或绕过队列即时调整。 */
export type ChatSubmitMode = "send" | "queue" | "steer";

/** Session 更早历史的分页状态。 */
export interface ChatHistoryState {
  /** 当前是否正在读取更早 Segment。 */
  loading: boolean;
  /** 当前结果之前是否仍有历史。 */
  has_more: boolean;
  /** 继续向前读取使用的 sequence 游标。 */
  next_before_sequence?: number;
}

/** Workspace 导航树中的一条 Session，并保留其执行 Agent。 */
export interface DesktopWorkspaceSession {
  /** 执行该 Session 的 Agent 标识。 */
  agent_id: string;
  /** Session 的导航摘要。 */
  session: DesktopSessionSummary;
}

/** 等待用户为孤儿 Session 选择 Workspace 的请求。 */
export interface SessionAttachRequest {
  /** Session 所属 Agent。 */
  agent_id: string;
  /** 等待绑定的 Session。 */
  session_id: string;
  /** 原始但已失效的 Workspace 标识。 */
  workspace_id: string;
  /** 完成绑定后需要继续发送的输入。 */
  pending_input?: JSONContent;
}

/** 可被 useSyncExternalStore 消费的稳定 store 句柄（结构类型，避免与实现文件循环依赖）。 */
interface StoreHandle<State> {
  /** 订阅 store 变化；返回取消订阅函数。 */
  subscribe(listener: () => void): () => void;
  /** 返回当前不可变快照；未变化时引用必须稳定。 */
  get_snapshot(): State;
}

/** 导航领域的完整不可变快照。 */
export interface NavigationStoreState {
  /** 当前主视图导航目标。 */
  selection: NavigationTarget | null;
  /** 主导航侧边栏当前模式。 */
  sidebar_mode: SidebarMode;
  /** 当前主视图使用的 Workspace 上下文。 */
  active_workspace_id: string;
  /** 各功能型 Power 的 Sidebar 与 Mainview 共享路由。 */
  power_routes: Record<string, PowerJsonObject>;
  /** 各功能型 Power 的快照刷新版本。 */
  power_revisions: Record<string, number>;
}

/** Catalog 领域的完整不可变快照。 */
export interface CatalogStoreState {
  /** 共享 Registry 中的全部 Agent。 */
  agents: DesktopAgentSummary[];
  /** 共享 Registry 中独立登记的全部 Workspace。 */
  workspaces: DesktopWorkspaceSummary[];
  /** 当前 Desktop City 中的运行时 Group。 */
  groups: DesktopGroupSummary[];
  /** 按 Group 标识缓存的运行时 Group。 */
  groups_by_id: Record<string, DesktopGroupSummary>;
  /** Desktop 当前可用的官方与第三方 Power。 */
  powers: DesktopPowerSummary[];
  /** 当前 Federation 中可用于对话的模型。 */
  models: DesktopModelSummary[];
  /** 模型目录是否正在读取。 */
  models_loading: boolean;
}

/** Session 导航索引领域的完整不可变快照。 */
export interface SessionStoreState {
  /** 按 Workspace 标识缓存的 Agent Session 导航数据。 */
  sessions_by_workspace: Record<string, DesktopWorkspaceSession[]>;
  /** 按 Workspace 标识缓存的已归档 Agent Session。 */
  archived_sessions_by_workspace: Record<string, DesktopWorkspaceSession[]>;
  /** 当前等待用户选择 Workspace 的孤儿 Session 请求。 */
  session_attach_request: SessionAttachRequest | null;
  /** 是否已经完整加载过一次 Session 目录；未完成时主体列表顺序尚未确定。 */
  hydrated: boolean;
}

/** Group 中等待成员响应的交互项。 */
export interface GroupInteraction {
  /** 发起交互的成员 Agent 标识。 */
  agent_id: string;
  /** 交互内容。 */
  part: SessionAgentInteraction;
}

/** 带 Turn 身份的实时文件改动摘要，避免跨轮复用旧状态。 */
export interface DesktopTurnFileDiffSummary extends SessionTurnFileDiffSummary {
  /** 摘要所属 Turn 的稳定标识。 */
  turn_id: string;
}

/** Chat 一行可以区分的实时运行状态；等待输入与未读注意力共用 action_required。 */
export type ChatLiveStatus = "working" | Extract<ChatAttention, "action_required">;

/** Chat 流式领域的完整不可变快照。 */
export interface ChatStreamState {
  /** 按 Session 组合键缓存的 canonical 可见消息。 */
  messages_by_session: Record<string, SessionMessage[]>;
  /** 按 Session 组合键缓存的实时运行态。 */
  chat_runtime_by_session: Record<string, DesktopChatRuntime>;
  /** 按 Session 组合键缓存的最新实时文件改动摘要；展示前必须匹配当前 Turn。 */
  file_diff_by_session: Record<string, DesktopTurnFileDiffSummary>;
  /** 按 Session 组合键缓存的模型与审批配置。 */
  configuration_by_session: Record<string, DesktopSessionConfiguration>;
  /** 按 Session 组合键保存的历史分页状态。 */
  history_by_session: Record<string, ChatHistoryState>;
  /** 按 Agent 标识缓存的 Chat 行状态；同一 Agent 有多个 Session 时取最需要用户注意的一个。 */
  agent_chat_status: Record<string, ChatLiveStatus>;
  /** 按 Group 标识缓存的持久共享消息分段。 */
  group_message_projection_by_group: Record<string, GroupMessageProjection>;
  /** 按 Group 标识缓存的成员运行态。 */
  group_member_statuses_by_group: Record<string, DesktopGroupMemberRuntime[]>;
  /** 按 Group 标识缓存的当前运行阶段。 */
  group_phase_by_group: Record<string, DesktopGroupStatusPhase>;
  /** 按 Group 标识缓存待响应的成员交互。 */
  group_interactions_by_group: Record<string, GroupInteraction[]>;
}

/** 输入编排领域的完整不可变快照。 */
export interface ComposerStoreState {
  /** 按 Session 组合键隔离的完整 Tiptap 输入草稿。 */
  draft_content_by_session: Record<string, JSONContent>;
  /** 按 Session 组合键隔离的待发送队列。 */
  queued_messages_by_session: Record<string, QueuedChatMessage[]>;
  /** 按 Session 组合键保存队列总暂停状态。 */
  queue_paused_by_session: Record<string, boolean>;
  /** 按 Session 组合键记录递增的输入聚焦请求序号（新建对话后把键盘焦点交给输入框）。 */
  focus_request_by_session: Record<string, number>;
}

/** 用户与偏好设置领域的完整不可变快照。 */
export interface SettingsStoreState {
  /** Desktop 用户级偏好。 */
  settings: DesktopSettings;
  /** 当前 Global Env 快照。 */
  global_env: string;
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
}

/** 组合层暴露的 7 个领域 store 句柄集合。 */
export interface DesktopStores {
  /** 导航领域 store（selection / sidebar_mode / active_workspace / power routes）。 */
  navigation: StoreHandle<NavigationStoreState>;
  /** Catalog 领域 store（agents / workspaces / groups / powers / models）。 */
  catalog: StoreHandle<CatalogStoreState>;
  /** Session 导航索引领域 store。 */
  session: StoreHandle<SessionStoreState>;
  /** Chat 流式领域 store（高频）。 */
  chat_stream: StoreHandle<ChatStreamState>;
  /** 输入编排领域 store。 */
  composer: StoreHandle<ComposerStoreState>;
  /** 用户与偏好设置领域 store。 */
  settings: StoreHandle<SettingsStoreState>;
  /** Desktop 通知领域 store。 */
  notification: StoreHandle<DesktopNotificationState>;
}

/** Renderer 对视图公开的稳定操作集合。 */
export interface DesktopActions {
  /** 选择 Agent 管理页。 */
  select_agent(agent_id: string): void;
  /** 打开 Agent 固定 Workspace 与持久化 Session 对话。 */
  open_agent_chat(agent_id: string): Promise<void>;
  /** 选择 Power 详情页。 */
  select_power(power_id: string): void;
  /** 返回完整 Power Catalog。 */
  select_powers(): void;
  /** 打开 Power 独立功能工作区。 */
  select_power_workspace(power_id: string): void;
  /** 替换指定 Power 的工作区路由。 */
  navigate_power(power_id: string, route: PowerJsonObject): void;
  /** 通知指定 Power 的 Sidebar 与 Mainview 重新读取业务快照。 */
  invalidate_power(power_id: string): void;
  /** 切换主导航侧边栏集合。 */
  set_sidebar_mode(mode: SidebarMode): void;
  /** 打开一个 Workspace，并将其设为 Chat 上下文。 */
  select_workspace(workspace_id: string): void;
  /** 在主视图中打开一个 Workspace 文件的只读预览；提供 line 时同时定位到该行。 */
  select_workspace_file(workspace_id: string, relative_path: string, line?: number): void;
  /** 选择 Group 配置页。 */
  select_group(group_id: string): void;
  /** 创建一个运行时 Group。 */
  create_group(input: DesktopCreateGroupInput): Promise<void>;
  /** 打开 Group 创建 MainView。 */
  open_create_group(): void;
  /** 更新一个 Group 定义。 */
  update_group(group_id: string, input: DesktopUpdateGroupInput): Promise<void>;
  /** 删除一个 Group。 */
  remove_group(group_id: string): Promise<void>;
  /** 为 Group 打开指定共享 Session。 */
  open_group(group_id: string, session_id?: string): Promise<void>;
  /** 为 Group 打开尚未持久化的新对话。 */
  create_group_session(group_id: string, workspace_id?: string): Promise<void>;
  /** 迁移当前 Group 草稿并切换 Workspace 上下文。 */
  switch_group_draft_context(group_id: string, workspace_id: string): Promise<void>;
  /** 修改 GroupSession 的 canonical 标题。 */
  rename_group_session(group_id: string, session_id: string, title: string): Promise<void>;
  /** 删除 Group 的共享 Session。 */
  remove_group_session(group_id: string, session_id: string): Promise<void>;
  /** 向指定 GroupSession 发送 Tiptap Chat Input。 */
  send_group_message(group_id: string, workspace_id: string, session_id: string, input: JSONContent): Promise<string | undefined>;
  /** 更新指定 Group Chat 的完整 Tiptap 草稿。 */
  update_group_draft(workspace_id: string, group_id: string, session_id: string, input: JSONContent): void;
  /** 停止 Group 当前执行。 */
  stop_group(group_id: string, session_id: string): Promise<void>;
  /** 响应 Group 成员交互。 */
  respond_group_interaction(group_id: string, session_id: string, input: RespondSessionInteractionInput): Promise<void>;
  /** 打开设置分区。 */
  open_settings(section?: SettingsSection): void;
  /** 离开设置并返回之前的业务视图。 */
  close_settings(): void;
  /**
   * 在指定 Workspace 切换到尚未持久化的空对话。
   *
   * `preserve_sidebar` 为真时保留当前侧栏：从 Works 侧栏新建时，新对话落在那个 Workspace 里，
   * 把用户切到 Agents 面板等于把他刚点的那棵树拿走。默认行为仍是切到会话所属的一级导航。
   */
  create_session(workspace_id: string, agent_id: string, preserve_sidebar?: boolean): Promise<void>;
  /** 迁移当前空对话草稿并切换 Workspace 或 Agent 上下文。 */
  switch_draft_context(workspace_id: string, agent_id: string): void;
  /** 切换到 Session Chat 并读取快照；可保持当前 Sidebar 集合。 */
  select_session(workspace_id: string, agent_id: string, session_id: string, preserve_sidebar?: boolean): Promise<void>;
  /** 从指定 canonical Message 创建分支 Session 并打开。 */
  fork_session(workspace_id: string, agent_id: string, session_id: string, message_id: string): Promise<void>;
  /** 重写历史用户消息，并按操作创建分支或替换当前 Session。 */
  rewrite_session_message(workspace_id: string, agent_id: string, session_id: string, input: DesktopChatRewriteInput): Promise<void>;
  /** 重命名一个 Session。 */
  rename_session(workspace_id: string, agent_id: string, session_id: string, title: string): Promise<void>;
  /** 归档一个 Session。 */
  archive_session(workspace_id: string, agent_id: string, session_id: string): Promise<void>;
  /** 永久删除一个 Session。 */
  remove_session(workspace_id: string, agent_id: string, session_id: string): Promise<void>;
  /** 关闭孤儿 Session 的 Workspace 选择。 */
  clear_session_attach_request(): void;
  /** 把孤儿 Session 重新绑定到指定 Workspace，并进入该 Session。 */
  rebind_session_workspace(agent_id: string, session_id: string, workspace_id: string): Promise<void>;
  /** 新建 Workspace 并立即绑定孤儿 Session，然后进入该 Session。 */
  create_workspace_for_session(value: CreateWorkspaceFormValue, agent_id: string, session_id: string): Promise<void>;
  /** 读取并缓存一个 Workspace 的已归档 Session。 */
  load_archived_sessions(workspace_id: string): Promise<void>;
  /** 读取当前 Session 的一个更早历史 Segment。 */
  load_earlier_history(workspace_id: string, agent_id: string, session_id: string): Promise<void>;
  /** 创建共享 Registry Agent。 */
  create_agent(value: CreateAgentFormValue): Promise<void>;
  /** 打开 Agent 创建 MainView。 */
  open_create_agent(): void;
  /** 读取 Agent 的完整定义。 */
  get_agent(agent_id: string): Promise<DesktopAgentDefinition>;
  /** 保存 Agent 定义并刷新 Renderer 摘要。 */
  update_agent(agent_id: string, input: DesktopUpdateAgentInput): Promise<void>;
  /** 永久删除 Agent 及其运行数据。 */
  remove_agent(agent_id: string): Promise<void>;
  /** 打开原生文件选择器并保存 Agent 头像。 */
  choose_agent_avatar(agent_id: string): Promise<void>;
  /** 删除 Agent 自定义头像。 */
  remove_agent_avatar(agent_id: string): Promise<void>;
  /** 从 Desktop 内置头像池随机选择并保存一张头像。 */
  generate_agent_avatar(agent_id: string): Promise<void>;
  /** 读取 Power manifest 与 Renderer 定义。 */
  get_power(power_id: string): Promise<DesktopPowerDefinition>;
  /** 调用当前 Power 的宿主管理 action。 */
  invoke_power_action(power_id: string, input: DesktopInvokePowerActionInput): ReturnType<Window["downcity"]["power"]["invoke"]>;
  /** 独立登记并打开 Workspace。 */
  create_workspace(value: CreateWorkspaceFormValue): Promise<void>;
  /** 更新 Workspace 的 Registry 显示名称。 */
  update_workspace_name(workspace_id: string, name: string): Promise<void>;
  /** 写入 Workspace 根目录 README.md。 */
  write_workspace_readme(workspace_id: string, content: string): Promise<void>;
  /** 从 Registry 移除 Workspace；不删除磁盘目录。 */
  remove_workspace(workspace_id: string): Promise<void>;
  /** 修改 Session 的完整 Tiptap 输入草稿。 */
  update_draft(workspace_id: string, agent_id: string, session_id: string, input: JSONContent): void;
  /** 发送消息；send 立即提交，queue 等待当前 Turn 完成后提交。绑定后补发时内部跳过孤儿检测。 */
  send_message(workspace_id: string, agent_id: string, session_id: string, input: JSONContent, mode?: ChatSubmitMode, skip_orphan_check?: boolean): Promise<void>;
  /** 刷新当前 Federation 模型目录。 */
  refresh_models(): Promise<void>;
  /** 为 Draft 或已存在 Session 选择模型。 */
  set_session_model(workspace_id: string, agent_id: string, session_id: string, model_id: string): Promise<void>;
  /** 切换当前 Session 的推理强度。 */
  set_session_reasoning_effort(workspace_id: string, agent_id: string, session_id: string, reasoning_effort?: string): Promise<void>;
  /** 为 Draft 或已存在 Session 选择审批模式。 */
  set_session_approval_mode(workspace_id: string, agent_id: string, session_id: string, approval_mode: DesktopSessionConfiguration["approval_mode"]): Promise<void>;
  /** 停止当前 Session Turn。 */
  stop_session(workspace_id: string, agent_id: string, session_id: string): Promise<void>;
  /** 响应当前 Session 的审批或问题。 */
  respond_interaction(workspace_id: string, agent_id: string, session_id: string, input: RespondSessionInteractionInput): Promise<void>;
  /** 删除一条尚未发送的队列消息。 */
  remove_queued_message(workspace_id: string, agent_id: string, session_id: string, message_id: string): void;
  /** 立即提交指定队列消息；Session 运行中时作为 steer。 */
  send_queued_message(workspace_id: string, agent_id: string, session_id: string, message_id: string): Promise<void>;
  /** 修改指定队列消息的文本，附件与引用保持不变。 */
  update_queued_message(workspace_id: string, agent_id: string, session_id: string, message_id: string, text: string): void;
  /** 切换指定队列消息的独立暂停状态。 */
  toggle_queued_message_paused(workspace_id: string, agent_id: string, session_id: string, message_id: string): void;
  /** 切换当前 Session 整个队列的暂停状态。 */
  set_queue_paused(workspace_id: string, agent_id: string, session_id: string, paused: boolean): void;
  /** 调整一条队列消息的顺序。 */
  move_queued_message(workspace_id: string, agent_id: string, session_id: string, message_id: string, direction: "up" | "down"): void;
  /** 合并 Desktop 用户级设置。 */
  update_settings(patch: Partial<DesktopSettings>): Promise<void>;
  /** 读取 Global Env。 */
  list_global_env(): Promise<string>;
  /** 保存 Global Env。 */
  update_global_env(raw: string): Promise<void>;
  /** 读取 Federation 当前允许登录的 Provider。 */
  list_login_providers(federation_url: string, force_refresh?: boolean): Promise<import("../../common/types/DesktopApi").DesktopLoginProvider[]>;
  /** 使用 Federation Provider 完成浏览器授权登录。 */
  login(federation_url: string, provider_id: string): Promise<void>;
  /** 退出当前 Federation 用户。 */
  logout(): Promise<void>;
  /** 切换已保存账户。 */
  switch_account(account_id: string): Promise<void>;
  /** 移除已保存账户。 */
  remove_account(account_id: string): Promise<void>;
  /** 清除当前用户可见错误。 */
  clear_error(): void;
  /** 把一次用户可见的失败上报到全局错误条。 */
  report_error(error: unknown): void;
}

/** Renderer 组件使用的稳定控制器，只暴露状态句柄与操作能力。 */
export interface DesktopController {
  /** 各领域独立的外置状态句柄。 */
  stores: DesktopStores;
  /** 不随状态快照变化的操作集合。 */
  actions: DesktopActions;
}

/** 生成一个 Agent 唯一的本地 Draft Chat 标识。 */
export function get_draft_session_id(agent_id: string): string {
  return `draft:${agent_id}`;
}

/** 生成一个 Group 唯一的本地 Draft Chat 标识。 */
export function get_group_draft_session_id(group_id: string): string {
  return `group-draft:${group_id}`;
}

/** 判断当前标识是否属于尚未持久化的 Draft Chat。 */
export function is_draft_session_id(session_id: string): boolean {
  return session_id.startsWith("draft:");
}

/** 判断当前标识是否属于尚未持久化的 Group Draft Chat。 */
export function is_group_draft_session_id(session_id: string): boolean {
  return session_id.startsWith("group-draft:");
}

/** 判断运行态是否仍占用当前 Session 执行槽。 */
export function is_chat_busy(runtime?: DesktopChatRuntime): boolean {
  return runtime?.status === "submitted"
    || runtime?.status === "streaming"
    || runtime?.status === "waiting_input";
}
