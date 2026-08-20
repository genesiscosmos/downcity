/**
 * Downcity Desktop 的 Renderer IPC 类型。
 *
 * 这些类型只描述可序列化的安全桥接边界，不暴露 Electron、数据库或 SDK 实例。
 */

import type { RespondSessionInteractionInput, SessionApprovalMode, SessionMessage, SessionMutation } from "@downcity/agent";

/** Renderer 可见的 Agent 摘要。 */
export interface DesktopAgentSummary {
  /** Agent 的全局稳定标识。 */
  agent_id: string;
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

/** Desktop main 中一个 Agent 已进入的 Workspace 执行边界。 */
export interface DesktopAgentWorkspace {
  /** 当前 Agent ID。 */
  agent_id: string;
  /** 当前进入的 Workspace ID。 */
  workspace_id: string;
  /** 当前执行使用的 Workspace。 */
  workspace: DesktopWorkspaceSummary;
}

/** 创建 Agent 便捷工作流的结果。 */
export interface DesktopCreateAgentResult {
  /** 新创建的独立 Agent 记录。 */
  agent: DesktopAgentSummary;
}

/** Agent 定义中的一个 Plugin 引用。 */
export interface DesktopAgentPluginReference {
  /** Plugin 使用的已保存 profile；不需要配置的 Plugin 不设置此字段。 */
  profile?: string;
}

/** Renderer 可编辑的完整 Agent 定义。 */
export interface DesktopAgentDefinition {
  /** Agent 的全局稳定标识；编辑时不可修改。 */
  agent_id: string;
  /** Agent 使用的默认模型标识。 */
  model_id: string;
  /** 从 SOUL.md 读取的 Agent 主体指令。 */
  instruction: string;
  /** 以 Plugin ID 为键的已注册 Plugin 引用。 */
  plugins: Record<string, DesktopAgentPluginReference>;
}

/** Desktop 更新 Agent 定义的输入。 */
export interface DesktopUpdateAgentInput {
  /** Agent 使用的默认模型标识。 */
  model_id: string;
  /** 写入 SOUL.md 的 Agent 主体指令。 */
  instruction: string;
  /** 保存到 agent.json 的 Plugin 引用。 */
  plugins: Record<string, DesktopAgentPluginReference>;
}

/** Renderer 可见的 Plugin 来源。 */
export type DesktopPluginSource = "builtin" | "installed";

/** Plugin 对持久化 profile 的要求。 */
export type DesktopPluginConfiguration = "none" | "optional" | "required";

/** Renderer 可见的 Plugin catalog 摘要。 */
export interface DesktopPluginSummary {
  /** Plugin 的全局稳定 ID。 */
  plugin_id: string;
  /** Plugin 的用户可见标题。 */
  title: string;
  /** Plugin 的用途说明。 */
  description: string;
  /** Plugin 的可选语义化版本。 */
  version?: string;
  /** Plugin 来自官方内置集合或第三方安装。 */
  source: DesktopPluginSource;
  /** 当前绑定该 Plugin 的全部 Agent ID。 */
  agent_ids: string[];
  /** 当前 Plugin 已保存的 profile 数量。 */
  profile_count: number;
  /** 当前 Plugin 可选择的 profile 标识。 */
  profile_ids: string[];
  /** Plugin 不需要、可选或必须选择持久化 profile。 */
  configuration: DesktopPluginConfiguration;
}

/** Renderer 可读取和编辑的完整 Plugin 定义。 */
export interface DesktopPluginDefinition extends DesktopPluginSummary {
  /** Plugin 声明的 JSON Schema；未声明时 Plugin 不需要配置。 */
  config_schema?: import("@downcity/agent").JsonObject;
  /** 根据 Schema default 与 const 注解创建的新 Profile 初始草稿。 */
  initial_config: import("@downcity/agent").JsonObject;
  /** 按稳定 Profile ID 索引的全部已保存配置。 */
  profiles: Record<string, import("@downcity/agent").JsonObject>;
}

/** Desktop 保存 Plugin Profile 的输入。 */
export interface DesktopSavePluginProfileInput {
  /** Profile 的稳定标识。 */
  profile_id: string;
  /** 经 Plugin setup 模块导出的 JSON Schema 校验后写入 TOML 的配置。 */
  config: import("@downcity/agent").JsonObject;
}

/** Renderer 可见的 Session 摘要。 */
export interface DesktopSessionSummary {
  /** Session 的稳定标识。 */
  session_id: string;
  /** Session 的可见标题。 */
  title: string;
  /** 最近一条可见消息的摘要。 */
  preview_text: string;
  /** Session 创建时间戳，单位为毫秒。 */
  created_at: number;
  /** Session 最近更新时间戳，单位为毫秒。 */
  updated_at: number;
  /** 当前已持久化消息数量。 */
  message_count: number;
  /** 当前 Session 是否仍在执行。 */
  executing: boolean;
}

/** Session 历史消息快照。 */
export interface DesktopChatSnapshot {
  /** 当前 Session 的可见 canonical 消息。 */
  messages: SessionMessage[];
  /** 当前 Session 的实时运行状态。 */
  runtime: DesktopChatRuntime;
  /** 当前结果之前是否还有更早历史 Segment。 */
  has_more: boolean;
  /** 读取更早 Segment 时使用的 sequence 游标。 */
  next_before_sequence?: number;
}

/** Session 的一页更早历史消息。 */
export interface DesktopChatHistoryPage {
  /** 当前历史 Segment 的可见 canonical 消息。 */
  messages: SessionMessage[];
  /** 当前结果之前是否还有更早历史 Segment。 */
  has_more: boolean;
  /** 继续向前读取时使用的 sequence 游标。 */
  next_before_sequence?: number;
}

/** Chat 运行阶段。 */
export type DesktopChatRuntimeStatus =
  | "idle"
  | "submitted"
  | "streaming"
  | "waiting_input"
  | "completed"
  | "failed"
  | "stopped";

/** Main 进程维护的一份 Session 运行态投影。 */
export interface DesktopChatRuntime {
  /** 运行态所属 Agent。 */
  agent_id: string;
  /** 运行态所属 Workspace。 */
  workspace_id: string;
  /** 运行态所属 Session。 */
  session_id: string;
  /** 当前运行阶段。 */
  status: DesktopChatRuntimeStatus;
  /** 当前活跃 Turn 标识。 */
  turn_id?: string;
  /** 最近一次失败的用户可见原因。 */
  error?: string;
  /** 运行态最近更新时间戳，单位为毫秒。 */
  updated_at: number;
}

/** IPC 广播的一条 Session mutation。 */
export interface DesktopChatMutationEvent {
  /** Mutation 所属 Agent。 */
  agent_id: string;
  /** Mutation 所属 Workspace。 */
  workspace_id: string;
  /** Mutation 所属 Session。 */
  session_id: string;
  /** SDK canonical Session mutation。 */
  mutation: SessionMutation;
}

/** IPC 广播的一条 Session 运行态变化。 */
export interface DesktopChatRuntimeEvent {
  /** 最新运行态快照。 */
  runtime: DesktopChatRuntime;
}

/** Chat 输入被 Session 接受后的结果。 */
export interface DesktopChatSendResult {
  /** 新建 Turn 的稳定标识。 */
  turn_id: string;
}

/** Renderer 可提交的一份文件输入。 */
export interface DesktopChatFileInput {
  /** 文件的原始名称。 */
  filename: string;
  /** 文件 MIME 类型；未知类型使用 application/octet-stream。 */
  media_type: string;
  /** 文件内容的 Data URL，进入 Session 后由 SDK 落盘。 */
  data_url: string;
}

/** Renderer 提交的一条 Session 消息引用。 */
export interface DesktopChatReferenceInput {
  /** 被引用 canonical 消息的稳定标识。 */
  message_id: string;
  /** 被引用消息在对话中的身份。 */
  role: "user" | "assistant";
  /** 提交时冻结的可读文本摘录。 */
  text: string;
}

/** Renderer 到 Session 的一次完整用户输入。 */
export interface DesktopChatInput {
  /** 用户输入的纯文本；只有附件时允许为空。 */
  text: string;
  /** 当前消息携带的文件列表。 */
  files: DesktopChatFileInput[];
  /** 当前消息显式引用的历史消息。 */
  references: DesktopChatReferenceInput[];
}

/** Federation 模型目录中的 Renderer 投影。 */
export interface DesktopModelSummary {
  /** Federation 模型稳定标识。 */
  model_id: string;
  /** 模型用户可见名称。 */
  name: string;
  /** 模型能力说明。 */
  description: string;
  /** 模型支持的能力类型。 */
  modalities: string[];
  /** 模型上下文窗口，单位为 token。 */
  context_window?: number;
  /** Federation 提供的模型标签。 */
  tags: string[];
  /** Federation 提供的价格说明列表；每项通常描述输入或输出 token 价格。 */
  price?: string[];
}

/** 当前 Session 可动态切换的配置。 */
export interface DesktopSessionConfiguration {
  /** 当前实际使用的模型标识。 */
  model_id: string;
  /** 当前安全审批模式。 */
  approval_mode: SessionApprovalMode;
}

/** Desktop 外观模式。 */
export type DesktopAppearanceMode = "light" | "dark" | "system";

/** Desktop 可选颜色主题。 */
export type DesktopColorTheme = "duobox" | "dim" | "forest" | "graph" | "haze" | "mono" | "ocean" | "sunset" | "vercel";

/** Desktop 用户级偏好设置。 */
export interface DesktopSettings {
  /** 是否展示模型推理内容。 */
  show_reasoning: boolean;
  /** 流式输出时是否自动跟随到底部。 */
  auto_scroll: boolean;
  /** 默认选中的 Agent；为空时使用列表第一项。 */
  default_agent_id: string;
  /** 启动后是否直接进入默认 Agent 的空对话。 */
  open_empty_chat_on_start: boolean;
  /** Enter 是否发送消息；关闭后使用 Command/Ctrl + Enter。 */
  send_message_on_enter: boolean;
  /** Chat 输入框是否启用系统拼写检查。 */
  spellcheck_enabled: boolean;
  /** 外观明暗模式。 */
  appearance_mode: DesktopAppearanceMode;
  /** 当前颜色主题。 */
  color_theme: DesktopColorTheme;
  /** Renderer UI 缩放比例，允许 0.85 到 1.2。 */
  ui_scale: number;
  /** 是否为 Electron 网络请求启用显式代理。 */
  proxy_enabled: boolean;
  /** Electron 接受的代理地址。 */
  proxy_url: string;
  /** 新建 Draft 默认使用的文本模型；为空时回退 Agent 模型。 */
  default_text_model_id: string;
  /** 生图能力默认使用的模型；为空时使用目录第一项。 */
  default_image_model_id: string;
}

/** Desktop 安全存储中的一个 Federation 账户摘要。 */
export interface DesktopAccountSummary {
  /** Desktop 账户稳定标识。 */
  account_id: string;
  /** 账户所属 Federation。 */
  federation_url: string;
  /** Federation 用户稳定标识。 */
  user_id: string;
  /** Token 绑定的 Bureau 标识。 */
  bureau_id: string;
  /** 用户展示名称。 */
  display_name?: string;
  /** 用户邮箱。 */
  email?: string;
  /** 用户头像地址。 */
  avatar_url?: string;
  /** 最近切换到该账户的时间戳。 */
  last_used_at: number;
  /** 是否为当前账户。 */
  active: boolean;
}

/** 当前 Credits Card 的 Renderer 投影。 */
export interface DesktopCreditCardSummary {
  /** Card 类型。 */
  kind: "primary" | "ephemeral";
  /** Card 稳定标识。 */
  card_id: string;
  /** Card 用户可见名称。 */
  name: string;
  /** Card 当前余额。 */
  credits: number;
  /** 限时 Card 到期时间；永久 Card 为空。 */
  expires_at?: string;
  /** Card 当前状态。 */
  status: "active" | "depleted" | "expired";
}

/** 当前账户的 Credits 余额。 */
export interface DesktopCreditsSummary {
  /** 当前全部 Card 的可用 Credits。 */
  available_credits: number;
  /** 当前用户的 Credits Card。 */
  cards: DesktopCreditCardSummary[];
}

/** 当前账户某个自然日的用量。 */
export interface DesktopUsageDay {
  /** 用户所在时区的日期，格式 YYYY-MM-DD。 */
  date: string;
  /** 当日已入账 Credits 消费。 */
  credits_used: number;
  /** 当日 Token 总量。 */
  total_tokens: number;
  /** 当日 AI 执行次数。 */
  execution_count: number;
  /** 当日生成图片数量。 */
  image_count: number;
}

/** 当前账户用量与余额快照。 */
export interface DesktopAccountResources {
  /** 一美元对应的 Credits 数量。 */
  credits_per_usd: number;
  /** 最近 365 个自然日的稀疏用量。 */
  usage_days: DesktopUsageDay[];
  /** 当前 Credits 余额；Federation 未安装 CreditsService 时为空。 */
  credits?: DesktopCreditsSummary;
  /** 余额读取失败原因。 */
  credits_error?: string;
  /** 用量读取失败原因。 */
  usage_error?: string;
}

/** Federation 当前用户的 Renderer 投影。 */
export interface DesktopUserSummary {
  /** 当前是否存在可用的 Federation Session。 */
  authenticated: boolean;
  /** 当前选中的 Federation 服务地址。 */
  federation_url: string;
  /** Federation 用户稳定标识。 */
  user_id?: string;
  /** Token 绑定的 Bureau 标识。 */
  bureau_id?: string;
  /** 用户展示名称。 */
  display_name?: string;
  /** 用户邮箱。 */
  email?: string;
  /** 用户头像地址。 */
  avatar_url?: string;
  /** 无法刷新远端资料时的错误文本。 */
  error?: string;
}

/** Federation 发布的一个 Desktop 登录 Provider。 */
export interface DesktopLoginProvider {
  /** Provider 稳定标识。 */
  provider_id: string;
  /** Provider 展示名称。 */
  label: string;
  /** Provider 交互类型。 */
  type: string;
  /** Provider 用途说明。 */
  description: string;
  /** Provider 是否允许登录。 */
  login_enabled: boolean;
}

/** 启动 Federation 登录的输入。 */
export interface DesktopLoginStartInput {
  /** 目标 Federation 地址。 */
  federation_url: string;
  /** 登录 Provider 稳定标识。 */
  provider_id: string;
}

/** Desktop 登录流程状态。 */
export type DesktopLoginStatus = "input_required" | "redirect_required" | "pending" | "done";

/** 启动 Federation 登录后的结果。 */
export interface DesktopLoginStartResult {
  /** 当前登录阶段。 */
  status: DesktopLoginStatus;
  /** 登录事务稳定标识。 */
  login_id: string;
  /** 实际使用的 Provider 标识。 */
  provider_id: string;
  /** 需要由系统浏览器打开的授权地址。 */
  url?: string;
  /** 输入型 Provider 声明的字段；Desktop 当前不处理该流程。 */
  inputs?: Array<Record<string, unknown>>;
}

/** 一次登录轮询的结果。 */
export interface DesktopLoginResult {
  /** 登录仍在等待、已经完成或远端明确失败。 */
  status: "pending" | "done" | "error";
  /** 登录事务稳定标识。 */
  login_id: string;
  /** 远端返回的失败原因。 */
  error?: string;
}

/** Preload 向 Renderer 暴露的最小 API。 */
export interface DesktopApi {
  /** Agent 注册和运行能力。 */
  agent: {
    /** 列出共享 Registry 中的全部 Agent。 */
    list(): Promise<DesktopAgentSummary[]>;
    /** 读取一份完整、可编辑的 Agent 定义。 */
    get(agent_id: string): Promise<DesktopAgentDefinition>;
    /** 创建共享注册记录。 */
    create(agent_id: string, model_id: string): Promise<DesktopCreateAgentResult>;
    /** 保存 Agent 定义并重新装配其运行实例。 */
    update(agent_id: string, input: DesktopUpdateAgentInput): Promise<DesktopAgentSummary>;
    /** 让 Agent 进入指定 Workspace。 */
    connect(agent_id: string, workspace_id: string): Promise<DesktopAgentWorkspace>;
  };
  /** 独立 Workspace Registry 能力。 */
  workspace: {
    /** 列出全部已登记 Workspace。 */
    list(): Promise<DesktopWorkspaceSummary[]>;
    /** 独立登记一个 Workspace；相同路径返回已有记录。 */
    create(workspace_path: string, name: string): Promise<DesktopWorkspaceSummary>;
  };
  /** 本地 Plugin catalog 能力。 */
  plugin: {
    /** 列出官方与第三方 Plugin，并附带当前 Agent 绑定。 */
    list(): Promise<DesktopPluginSummary[]>;
    /** 读取 Plugin manifest 与全部 Profile。 */
    get(plugin_id: string): Promise<DesktopPluginDefinition>;
    /** 新建或替换一个 Profile。 */
    save_profile(plugin_id: string, input: DesktopSavePluginProfileInput): Promise<DesktopPluginDefinition>;
    /** 删除未被 Agent 引用的 Profile。 */
    remove_profile(plugin_id: string, profile_id: string): Promise<DesktopPluginDefinition>;
  };
  /** Electron 原生文件选择能力。 */
  dialog: {
    /** 选择一个 Workspace 目录；取消时返回 null。 */
    open_directory(): Promise<string | null>;
  };
  /** Agent Session 与聊天能力。 */
  chat: {
    /** 读取当前 Federation 中可用于 Agent 对话的模型目录。 */
    list_models(): Promise<DesktopModelSummary[]>;
    /** 列出指定 Agent 的 Session。 */
    list_sessions(agent_id: string, workspace_id: string): Promise<DesktopSessionSummary[]>;
    /** 创建新的 Session。 */
    create_session(agent_id: string, workspace_id: string): Promise<DesktopSessionSummary>;
    /** 修改 Session 的用户可见标题。 */
    rename_session(agent_id: string, workspace_id: string, session_id: string, title: string): Promise<string>;
    /** 将 Session 移入归档。 */
    archive_session(agent_id: string, workspace_id: string, session_id: string): Promise<void>;
    /** 永久删除 Session。 */
    remove_session(agent_id: string, workspace_id: string, session_id: string): Promise<boolean>;
    /** 列出指定 Agent 的已归档 Session。 */
    list_archived_sessions(agent_id: string, workspace_id: string): Promise<DesktopSessionSummary[]>;
    /** 读取 Session canonical 消息和当前运行态。 */
    get_snapshot(agent_id: string, workspace_id: string, session_id: string): Promise<DesktopChatSnapshot>;
    /** 读取 Session 的一个更早历史 Segment。 */
    get_history(agent_id: string, workspace_id: string, session_id: string, before_sequence: number): Promise<DesktopChatHistoryPage>;
    /** 提交输入并在 Session 接受后返回。 */
    send(agent_id: string, workspace_id: string, session_id: string, input: DesktopChatInput): Promise<DesktopChatSendResult>;
    /** 停止当前 Session Turn。 */
    stop(agent_id: string, workspace_id: string, session_id: string): Promise<void>;
    /** 响应 Session 当前等待的审批或问题。 */
    respond(agent_id: string, workspace_id: string, session_id: string, input: RespondSessionInteractionInput): Promise<void>;
    /** 读取当前 Session 运行态。 */
    get_runtime(agent_id: string, workspace_id: string, session_id: string): Promise<DesktopChatRuntime>;
    /** 读取当前 Session 的模型与审批配置。 */
    get_configuration(agent_id: string, workspace_id: string, session_id: string): Promise<DesktopSessionConfiguration>;
    /** 切换当前 Session 模型。 */
    set_model(agent_id: string, workspace_id: string, session_id: string, model_id: string): Promise<DesktopSessionConfiguration>;
    /** 切换当前 Session 审批模式。 */
    set_approval_mode(agent_id: string, workspace_id: string, session_id: string, approval_mode: SessionApprovalMode): Promise<DesktopSessionConfiguration>;
    /** 订阅 canonical Session mutation。 */
    on_mutation(callback: (event: DesktopChatMutationEvent) => void): () => void;
    /** 订阅 Session 运行态变化。 */
    on_runtime(callback: (event: DesktopChatRuntimeEvent) => void): () => void;
  };
  /** Desktop 用户级设置。 */
  settings: {
    /** 读取当前设置。 */
    get(): Promise<DesktopSettings>;
    /** 合并并保存设置。 */
    update(patch: Partial<DesktopSettings>): Promise<DesktopSettings>;
  };
  /** Downcity Federation 当前用户。 */
  user: {
    /** 读取并尽可能刷新当前用户资料。 */
    current(): Promise<DesktopUserSummary>;
    /** 读取 Federation 动态发布的登录 Provider。 */
    list_login_providers(federation_url: string, force_refresh?: boolean): Promise<DesktopLoginProvider[]>;
    /** 启动一个 Federation Provider 登录流程。 */
    start_login(input: DesktopLoginStartInput): Promise<DesktopLoginStartResult>;
    /** 查询登录流程，并在成功后保存和激活账户。 */
    get_login_result(login_id: string): Promise<DesktopLoginResult>;
    /** 取消一个尚未完成的登录流程。 */
    cancel_login(login_id: string): Promise<void>;
    /** 列出 Desktop 保存的全部 Federation 账户。 */
    list_accounts(): Promise<DesktopAccountSummary[]>;
    /** 切换当前 Federation 账户。 */
    switch_account(account_id: string): Promise<DesktopUserSummary>;
    /** 删除一个已保存账户，并返回新的当前用户。 */
    remove_account(account_id: string): Promise<DesktopUserSummary>;
    /** 读取当前用户 Credits 与最近 365 天用量。 */
    get_resources(): Promise<DesktopAccountResources>;
    /** 清除当前 Federation Session。 */
    logout(): Promise<DesktopUserSummary>;
  };
}

declare global {
  interface Window {
    /** Electron Preload 暴露的 Downcity API。 */
    downcity: DesktopApi;
  }
}
