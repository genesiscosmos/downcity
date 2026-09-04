/**
 * Downcity Desktop 的 Renderer IPC 类型。
 *
 * 这些类型只描述可序列化的安全桥接边界，不暴露 Electron、数据库或 SDK 实例。
 */

import type { RespondSessionInteractionInput, SessionApprovalMode, SessionInteractionRequest, SessionMessage, SessionMutation } from "@downcity/agent";
import type { JSONContent } from "@tiptap/core";
import type { DesktopNotificationState, DesktopNotificationViewState } from "./DesktopNotification.js";

/** Renderer 可见的 Agent 摘要。 */
export interface DesktopAgentSummary {
  /** Agent 的全局稳定标识。 */
  agent_id: string;
  /** Agent 的用户可见名称。 */
  name: string;
  /** Agent 对外展示的身份简介。 */
  description: string;
  /** Agent 头像的 data URL；未配置头像时为空。 */
  avatar_url?: string;
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
  /** Workspace 根目录 README.md 的当前内容。 */
  readme: string;
  /** Workspace 首次登记时间，使用 ISO 8601 字符串。 */
  created_at: string;
  /** Workspace 最近更新时间，使用 ISO 8601 字符串。 */
  updated_at: string;
}

/** Renderer 创建 Workspace 时提交的信息。 */
export interface DesktopCreateWorkspaceInput {
  /** Workspace 指向的绝对目录。 */
  workspace_path: string;
  /** Workspace 的用户可见名称。 */
  name: string;
}

/** Renderer 可见的 Group 成员。 */
export interface DesktopGroupMember {
  /** 成员 Agent 的稳定标识。 */
  agent_id: string;
}

/** Renderer 可见的运行时 Group 摘要。 */
export interface DesktopGroupSummary {
  /** Group 的稳定标识。 */
  group_id: string;
  /** Group 的用户可见名称。 */
  name: string;
  /** Group 用于理解群聊意图并决定消息投递的模型标识。 */
  model_id: string;
  /** Group 的协作目标。 */
  instruction?: string;
  /** Group 当前成员。 */
  members: DesktopGroupMember[];
  /** Group 当前消息数量。 */
  message_count: number;
  /** Group 下可恢复的群聊会话摘要。 */
  sessions: DesktopGroupSessionSummary[];
  /** 当前打开的 GroupSession 标识。 */
  active_session_id?: string;
}

/** Renderer 可见的 GroupSession 摘要。 */
export interface DesktopGroupSessionSummary {
  /** GroupSession 稳定标识。 */
  session_id: string;
  /** GroupSession 的 canonical 用户可见标题。 */
  title: string;
  /** 首次创建时间戳，单位为毫秒。 */
  created_at: number;
  /** 最近更新时间戳，单位为毫秒。 */
  updated_at: number;
  /** 已持久化消息数量。 */
  message_count: number;
  /** 当前 GroupSession 绑定的 Workspace ID；未绑定时为空。 */
  workspace_id?: string;
  /** 最后一条消息的可见预览。 */
  preview_text?: string;
}

/** Group 默认 Session 的本地绑定。 */
export interface DesktopGroupMainSession {
  /** 默认 GroupSession 所属 Workspace 标识。 */
  workspace_id: string;
  /** 默认 GroupSession 的稳定标识。 */
  session_id: string;
}

/** Renderer 可见的一条 Group 共享消息。 */
export interface DesktopGroupMessage {
  /** 消息稳定标识。 */
  message_id: string;
  /** 消息作者类型。 */
  author_type: "user" | "agent" | "system";
  /** Agent 作者标识；用户和系统消息没有该字段。 */
  author_id?: string;
  /** 消息文本。 */
  text: string;
  /** 创建时间戳，单位为毫秒。 */
  created_at: number;
}

/** GroupSession 的统一实时事件。 */
export type DesktopGroupEvent = {
  /** 所属 Group 标识。 */
  readonly group_id: string;
  /** 所属 GroupSession 标识。 */
  readonly session_id: string;
  /** 事件类型。 */
  readonly type: "message";
  /** 新增的共享消息。 */
  readonly message: DesktopGroupMessage;
} | {
  /** 所属 Group 标识。 */
  readonly group_id: string;
  /** 所属 GroupSession 标识。 */
  readonly session_id: string;
  /** 事件类型。 */
  readonly type: "title";
  /** 当前 GroupSession 最新的 canonical 标题。 */
  readonly title: string;
} | {
  /** 所属 Group 标识。 */
  readonly group_id: string;
  /** 所属 GroupSession 标识。 */
  readonly session_id: string;
  /** 事件类型。 */
  readonly type: "interaction";
  /** 发起交互的成员 Agent。 */
  readonly agent_id: string;
  /** 成员 Agent Session 的交互请求。 */
  readonly request: SessionInteractionRequest;
} | {
  /** 所属 Group 标识。 */
  readonly group_id: string;
  /** 所属 GroupSession 标识。 */
  readonly session_id: string;
  /** 事件类型。 */
  readonly type: "status";
  /** 当前群聊轮次标识。 */
  readonly turn_id?: string;
  /** 当前轮次对应的 Group 消息标识。 */
  readonly message_id?: string;
  /** 当前 Group 运行阶段。 */
  readonly phase: "idle" | "dispatching" | "dispatched" | "executing" | "stopped" | "failed";
  /** Dispatch 完成后实际接受消息的成员标识。 */
  readonly dispatched_member_ids?: string[];
  /** 当前全部成员运行态。 */
  readonly members: DesktopGroupMemberRuntime[];
};

/** Renderer 可见的 Group 成员运行态。 */
export interface DesktopGroupMemberRuntime {
  /** 成员 Agent 标识。 */
  agent_id: string;
  /** 当前是否正在执行。 */
  running: boolean;
}

/** GroupSession 的当前运行阶段。 */
export type DesktopGroupStatusPhase = "idle" | "dispatching" | "dispatched" | "executing" | "stopped" | "failed";

/** 创建运行时 Group 的输入。 */
export interface DesktopCreateGroupInput {
  /** Group 用户可见名称；内部 ID 由宿主基于此字段生成。 */
  name: string;
  /** Group 用于理解群聊意图并决定消息投递的模型标识。 */
  model_id: string;
  /** Group 协作目标。 */
  instruction?: string;
  /** 成员 Agent 标识。 */
  member_agent_ids: string[];
}

/** 使用 AI 生成 Group 草稿的输入。 */
export interface DesktopGenerateGroupDraftInput {
  /** 用户对目标协作团队的自然语言描述。 */
  prompt: string;
  /** 执行草稿生成的模型标识。 */
  model_id: string;
  /** 当前可供 AI 推荐的 Agent 摘要。 */
  agents: Array<{ /** Agent 稳定标识。 */ agent_id: string; /** Agent 用户可见名称。 */ name: string; /** Agent 身份简介。 */ description: string }>;
}

/** AI 生成但尚未持久化的 Group 草稿。 */
export interface DesktopGroupDraft {
  /** AI 建议的 Group 名称。 */
  name: string;
  /** AI 建议的协作目标。 */
  instruction: string;
  /** AI 推荐的成员 Agent 标识。 */
  member_agent_ids: string[];
}

/** 更新 Desktop Group 定义的输入。 */
export interface DesktopUpdateGroupInput {
  /** Group 用户可见名称。 */
  name: string;
  /** Group 用于理解群聊意图并决定消息投递的模型标识。 */
  model_id: string;
  /** Group 协作目标。 */
  instruction: string;
  /** Group 成员 Agent 标识。 */
  member_agent_ids: string[];
}

/** 向 Group 发送一条文本消息的输入。 */
export interface DesktopGroupSendInput {
  /** 要发送的非空文本。 */
  text: string;
}

/** Desktop main 中一次 Agent 与 Workspace 的连接结果。 */
export interface DesktopAgentConnection {
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

/** Desktop 创建 Agent 时一次性提交的完整配置。 */
export interface DesktopCreateAgentInput {
  /** Agent 的用户可见名称；内部 ID 由宿主基于此字段生成。 */
  name: string;
  /** Agent 对外展示的身份简介。 */
  description: string;
  /** 写入 SOUL.md 的 Agent 主体指令。 */
  instruction: string;
  /** Agent 使用的默认模型标识。 */
  model_id: string;
  /** Agent 初始启用的 Plugin 引用。 */
  plugins: Record<string, DesktopAgentPluginReference>;
}

/** 使用 AI 生成 Agent 草稿的输入。 */
export interface DesktopGenerateAgentDraftInput {
  /** 用户对目标角色的自然语言描述。 */
  prompt: string;
  /** 执行草稿生成的系统默认模型标识。 */
  model_id: string;
  /** 当前可供 AI 推荐的 Plugin 摘要。 */
  plugins: Array<{ /** Plugin 稳定标识。 */ plugin_id: string; /** Plugin 用户可见名称。 */ title: string; /** Plugin 能力说明。 */ description: string }>;
}

/** AI 生成但尚未持久化的 Agent 草稿。 */
export interface DesktopAgentDraft {
  /** AI 建议的用户可见名称。 */
  name: string;
  /** AI 建议的身份简介。 */
  description: string;
  /** AI 建议写入 SOUL.md 的主体指令。 */
  instruction: string;
  /** AI 推荐启用的 Plugin 标识。 */
  plugin_ids: string[];
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
  /** Agent 的用户可见名称。 */
  name: string;
  /** Agent 对外展示的身份简介。 */
  description: string;
  /** Agent 使用的默认模型标识。 */
  model_id: string;
  /** 从 SOUL.md 读取的 Agent 主体指令。 */
  instruction: string;
  /** 以 Plugin ID 为键的已注册 Plugin 引用。 */
  plugins: Record<string, DesktopAgentPluginReference>;
}

/** Desktop 更新 Agent 定义的输入。 */
export interface DesktopUpdateAgentInput {
  /** Agent 的用户可见名称；不会改变稳定 Agent ID。 */
  name: string;
  /** Agent 对外展示的身份简介。 */
  description: string;
  /** Agent 使用的默认模型标识。 */
  model_id: string;
  /** 写入 SOUL.md 的 Agent 主体指令。 */
  instruction: string;
  /** 保存到 agent.json 的 Plugin 引用。 */
  plugins: Record<string, DesktopAgentPluginReference>;
}

/** Renderer 可见的 Plugin 来源。 */
export type DesktopPluginSource = "builtin" | "installed";

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
  /** Plugin 自己声明的可选图标 URL。 */
  icon_url?: string;
  /** Plugin 来自官方内置集合或第三方安装。 */
  source: DesktopPluginSource;
  /** 当前绑定该 Plugin 的全部 Agent ID。 */
  agent_ids: string[];
  /** 当前 Plugin 已保存的 profile 数量。 */
  profile_count: number;
  /** 当前 Plugin 可选择的 profile 标识。 */
  profile_ids: string[];
  /** Plugin 是否提供统一 City main，因此可以绑定到 Agent。 */
  has_main: boolean;

  /** Plugin 是否提供专属 Sidebar。 */
  has_sidebar: boolean;

  /** Plugin 是否提供业务 Mainview。 */
  has_mainview: boolean;

  /** Plugin 是否提供设置中心 Config。 */
  has_config: boolean;
}

/** Renderer 可读取和编辑的完整 Plugin 定义。 */
export interface DesktopPluginDefinition extends DesktopPluginSummary {
  /** Plugin 自己拥有并由宿主安全渲染的 Markdown 用户说明。 */
  readme?: string;
  /** 第三方 Renderer ESM 的受控宿主 URL；内置 Plugin 由 Renderer registry 解析。 */
  renderer_url?: string;
}

/** Desktop 创建 Plugin Profile 的输入。 */
export interface DesktopCreatePluginProfileInput {
  /** Profile 的稳定标识。 */
  profile_id: string;
}

/** Desktop 调用 Plugin Mainview action 的输入。 */
export interface DesktopInvokePluginMainviewActionInput {
  /** 明确标识调用来自 Plugin 业务工作区。 */
  surface: "mainview";

  /** Plugin main 注册的稳定 action ID。 */
  action_id: string;

  /** Mainview 传给 action 的可选 JSON 输入。 */
  input?: import("@downcity/city/plugin").PluginJsonValue;
}

/** Desktop 调用 Plugin Config action 的输入。 */
export interface DesktopInvokePluginConfigActionInput {
  /** 明确标识调用来自设置中心的 Config 界面。 */
  surface: "config";

  /** 当前配置界面绑定的 Profile ID。 */
  profile_id: string;

  /** Plugin main 注册的稳定 action ID。 */
  action_id: string;

  /** Config 传给 action 的可选 JSON 输入。 */
  input?: import("@downcity/city/plugin").PluginJsonValue;
}

/** Desktop Renderer 调用 Plugin main 的两个互斥动作范围。 */
export type DesktopInvokePluginActionInput =
  | DesktopInvokePluginMainviewActionInput
  | DesktopInvokePluginConfigActionInput;

/** Renderer 可见的 Session 摘要。 */
export interface DesktopSessionSummary {
  /** Session 的稳定标识。 */
  session_id: string;
  /** Session 在当前设备上的真实存储目录。 */
  session_path: string;
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
  /** Session 绑定的 Workspace ID；未绑定时为空。 */
  workspace_id?: string;
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

/** 历史用户消息重写方式。 */
export type DesktopChatRewriteAction = "rollback" | "fork";

/** Renderer 提交的一次历史用户消息重写。 */
export interface DesktopChatRewriteInput {
  /** 被替换的 canonical 用户消息标识。 */
  message_id: string;
  /** 修改后的非空文本。 */
  text: string;
  /** 创建独立分支，或用新 Session 替代并归档当前 Session。 */
  action: DesktopChatRewriteAction;
}

/** 历史消息重写被接受后的新 Session。 */
export interface DesktopChatRewriteResult {
  /** 承载修改后消息的新 Session 摘要。 */
  session: DesktopSessionSummary;
  /** 修改后的消息已启动的 Turn 标识。 */
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

/** 当前 Workspace 根目录中的可引用文件。 */
export interface DesktopWorkspaceFile {
  /** 相对于 Workspace 根目录的文件路径。 */
  relative_path: string;
  /** 文件名。 */
  filename: string;
  /** 文件最近修改时间戳，单位为毫秒。 */
  modified_at: number;
}

/** Workspace 文件树中的一个直接子节点。 */
export interface DesktopWorkspaceEntry {
  /** 相对于 Workspace 根目录的规范化路径；统一使用正斜杠。 */
  relative_path: string;
  /** 节点的文件或目录名称。 */
  name: string;
  /** 节点是否为可继续展开的目录。 */
  kind: "directory" | "file";
  /** 文件大小，单位为字节；目录不提供该字段。 */
  size?: number;
  /** 节点最近修改时间戳，单位为毫秒。 */
  modified_at: number;
}

/** Workspace 文本文件的只读内容。 */
export interface DesktopWorkspaceTextFile {
  /** 相对于 Workspace 根目录的规范化路径。 */
  relative_path: string;
  /** 文件名。 */
  name: string;
  /** 用于只读预览的 UTF-8 文本。 */
  content: string;
  /** 文件大小，单位为字节。 */
  size: number;
}

/** 模型支持的推理强度档位。 */
export interface DesktopModelReasoningEffort {
  /** 档位唯一标识，同时也是请求参数使用的值。 */
  id: string;
  /** 面向用户展示的档位名称。 */
  name: string;
  /** 面向用户展示的档位说明。 */
  description?: string;
}

/** 模型公开的推理强度配置。 */
export interface DesktopModelReasoning {
  /** 模型支持的推理强度档位，数组顺序即前端展示顺序。 */
  efforts: DesktopModelReasoningEffort[];
  /** 模型未显式指定推理强度时使用的默认档位标识。 */
  default_effort?: string;
}

/** Federation 结构化模型价格在 Desktop IPC 边界的可序列化投影。 */
export interface DesktopModelPricing {
  /** ISO 4217 货币代码，例如 USD 或 CNY。 */
  currency: string;
  /** 计费对象，例如 token、request 或 image。 */
  unit: string;
  /** 每个价格对应的计费单位数量。 */
  scale?: number;
  /** 命名计费组件及其价格，例如 input、output。 */
  rates: Record<string, number>;
  /** 价格适用的条件维度，例如时段、分辨率或上下文档位。 */
  dimensions?: Record<string, string>;
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
  /** Federation 提供的结构化价格方案。 */
  pricing?: DesktopModelPricing[];
  /** 模型公开的推理强度档位；未提供时表示模型不支持可配置推理强度。 */
  reasoning?: DesktopModelReasoning;
}

/** 当前 Session 可动态切换的配置。 */
export interface DesktopSessionConfiguration {
  /** 当前实际使用的模型标识。 */
  model_id: string;
  /** 当前模型生效的推理强度档位标识。 */
  reasoning_effort?: string;
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
  /** 每个 Agent 主 Session 所绑定的 Workspace 与 Session。 */
  agent_main_sessions: Record<string, DesktopAgentMainSession>;
  /** 每个 Group 默认 Session 所绑定的 Workspace 与 Session。 */
  group_main_sessions: Record<string, DesktopGroupMainSession>;
}

/** Agent 主 Session 的本地绑定。 */
export interface DesktopAgentMainSession {
  /** 主 Session 使用的 Workspace 标识。 */
  workspace_id: string;
  /** 主 Session 的稳定标识。 */
  session_id: string;
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
  /** Desktop 宿主提供的系统级打开能力。 */
  system: {
    /** 使用系统默认浏览器打开 HTTP(S) 地址。 */
    open_external_url(url: string): Promise<void>;
    /** 使用系统默认应用打开绝对本地文件。 */
    open_local_file(file_path: string): Promise<void>;
  };
  /** Desktop 未读通知与当前观察目标能力。 */
  notification: {
    /** 读取当前完整未读通知状态。 */
    get_state(): Promise<DesktopNotificationState>;
    /** 报告当前 Renderer 是否正在实际查看一个通知目标。 */
    set_view_state(state: DesktopNotificationViewState): Promise<void>;
    /** 订阅未读通知状态变化。 */
    subscribe(callback: (state: DesktopNotificationState) => void): () => void;
  };
  /** Agent 注册和运行能力。 */
  agent: {
    /** 列出共享 Registry 中的全部 Agent。 */
    list(): Promise<DesktopAgentSummary[]>;
    /** 读取一份完整、可编辑的 Agent 定义。 */
    get(agent_id: string): Promise<DesktopAgentDefinition>;
    /** 创建共享注册记录。 */
    create(input: DesktopCreateAgentInput): Promise<DesktopCreateAgentResult>;
    /** 根据自然语言描述生成一份可编辑的 Agent 草稿。 */
    generate_draft(input: DesktopGenerateAgentDraftInput): Promise<DesktopAgentDraft>;
    /** 保存 Agent 定义并重新装配其运行实例。 */
    update(agent_id: string, input: DesktopUpdateAgentInput): Promise<DesktopAgentSummary>;
    /** 永久删除 Agent 及其用户级运行数据。 */
    remove(agent_id: string): Promise<boolean>;
    /** 打开原生文件选择器并保存 Agent 头像。取消选择时返回空值。 */
    choose_avatar(agent_id: string): Promise<DesktopAgentSummary | null>;
    /** 删除 Agent 自定义头像。 */
    remove_avatar(agent_id: string): Promise<DesktopAgentSummary>;
    /** 从 Desktop 内置头像池随机选择并保存一张头像。 */
    generate_avatar(agent_id: string): Promise<DesktopAgentSummary>;
    /** 让 Agent 进入指定 Workspace。 */
    connect(agent_id: string, workspace_id: string): Promise<DesktopAgentConnection>;
  };
  /** 独立 Workspace Registry 能力。 */
  workspace: {
    /** 列出全部已登记 Workspace。 */
    list(): Promise<DesktopWorkspaceSummary[]>;
    /** 获取并登记 Desktop Agent 主聊天的默认 Workspace。 */
    get_default(): Promise<DesktopWorkspaceSummary>;
    /** 独立登记一个 Workspace；相同路径返回已有记录。 */
    create(input: DesktopCreateWorkspaceInput): Promise<DesktopWorkspaceSummary>;
    /** 更新 Workspace 的 Registry 显示名称。 */
    update_name(workspace_id: string, name: string): Promise<DesktopWorkspaceSummary>;
    /** 从 Registry 移除 Workspace；不删除磁盘目录。 */
    remove(workspace_id: string): Promise<boolean>;
    /** 将内容写入 Workspace 根目录 README.md。 */
    write_readme(workspace_id: string, content: string): Promise<DesktopWorkspaceSummary>;
    /** 列出 Workspace 指定目录的直接子节点。 */
    list_entries(workspace_id: string, relative_path?: string): Promise<DesktopWorkspaceEntry[]>;
    /** 读取 Workspace 中的 UTF-8 文本文件用于只读预览。 */
    read_text_file(workspace_id: string, relative_path: string): Promise<DesktopWorkspaceTextFile>;
  };
  /** 本地 Plugin catalog 能力。 */
  plugin: {
    /** 列出官方与第三方 Plugin，并附带当前 Agent 绑定。 */
    list(): Promise<DesktopPluginSummary[]>;
    /** 读取 Plugin manifest 与全部 Profile。 */
    get(plugin_id: string): Promise<DesktopPluginDefinition>;
    /** 创建一个空 Profile，具体配置由 Plugin Mainview 写入。 */
    create_profile(plugin_id: string, input: DesktopCreatePluginProfileInput): Promise<DesktopPluginDefinition>;
    /** 删除未被 Agent 引用的 Profile。 */
    remove_profile(plugin_id: string, profile_id: string): Promise<DesktopPluginDefinition>;
    /** 按业务工作区或 Config 范围调用 Plugin main action。 */
    invoke(plugin_id: string, input: DesktopInvokePluginActionInput): Promise<import("@downcity/city/plugin").PluginJsonValue>;
  };
  /** Electron 原生文件选择能力。 */
  dialog: {
    /** 选择一个 Workspace 目录；取消时返回 null。 */
    open_directory(): Promise<string | null>;
  };
  /** Agent Session 与聊天能力。 */
  chat: {
    /** 列出当前 Workspace 根目录中按修改时间倒序排列的文件。 */
    list_workspace_files(workspace_id: string): Promise<DesktopWorkspaceFile[]>;
    /** 读取当前 Workspace 根目录中的一个文件并转换为可提交附件。 */
    read_workspace_file(workspace_id: string, relative_path: string): Promise<DesktopChatFileInput>;
    /** 读取当前 Federation 中可用于 Agent 对话的模型目录。 */
    list_models(): Promise<DesktopModelSummary[]>;
    /** 列出指定 Agent 的 Session；可传入 Workspace 过滤，不传时返回全部。 */
    list_sessions(agent_id: string, workspace_id?: string): Promise<DesktopSessionSummary[]>;
    /** 把 Session 重新绑定到另一个 Workspace，并返回新上下文下的摘要。 */
    rebind_session_workspace(agent_id: string, session_id: string, workspace_id: string): Promise<DesktopSessionSummary>;
    /** 创建新的 Session。 */
    create_session(agent_id: string, workspace_id: string): Promise<DesktopSessionSummary>;
    /** 从指定消息创建一个新的分支 Session。 */
    fork_session(agent_id: string, workspace_id: string, session_id: string, message_id: string): Promise<DesktopSessionSummary>;
    /** 从历史用户消息之前创建 Session 并发送修改后的文本。 */
    rewrite_session_message(agent_id: string, workspace_id: string, session_id: string, input: DesktopChatRewriteInput): Promise<DesktopChatRewriteResult>;
    /** 修改 Session 的用户可见标题。 */
    rename_session(agent_id: string, workspace_id: string, session_id: string, title: string): Promise<string>;
    /** 将 Session 移入归档。 */
    archive_session(agent_id: string, workspace_id: string, session_id: string): Promise<void>;
    /** 永久删除 Session。 */
    remove_session(agent_id: string, workspace_id: string, session_id: string): Promise<boolean>;
    /** 列出指定 Agent 的已归档 Session；可传入 Workspace 过滤，不传时返回全部。 */
    list_archived_sessions(agent_id: string, workspace_id?: string): Promise<DesktopSessionSummary[]>;
    /** 读取 Session canonical 消息和当前运行态。 */
    get_snapshot(agent_id: string, workspace_id: string, session_id: string): Promise<DesktopChatSnapshot>;
    /** 读取 Session 的一个更早历史 Segment。 */
    get_history(agent_id: string, workspace_id: string, session_id: string, before_sequence: number): Promise<DesktopChatHistoryPage>;
    /** 提交输入并在 Session 接受后返回。 */
    send(agent_id: string, workspace_id: string, session_id: string, input: JSONContent): Promise<DesktopChatSendResult>;
    /** 将显式压缩命令加入 Session 的有序执行队列。 */
    compact_session(agent_id: string, workspace_id: string, session_id: string): Promise<void>;
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
    /** 设置当前 Session 的推理强度档位。 */
    set_reasoning_effort(agent_id: string, workspace_id: string, session_id: string, reasoning_effort?: string): Promise<DesktopSessionConfiguration>;
    /** 切换当前 Session 审批模式。 */
    set_approval_mode(agent_id: string, workspace_id: string, session_id: string, approval_mode: SessionApprovalMode): Promise<DesktopSessionConfiguration>;
    /** 订阅 canonical Session mutation。 */
    on_mutation(callback: (event: DesktopChatMutationEvent) => void): () => void;
    /** 订阅 Session 运行态变化。 */
    on_runtime(callback: (event: DesktopChatRuntimeEvent) => void): () => void;
  };
  /** 运行时 Group 与共享消息能力。 */
  group: {
    /** 列出当前 Desktop City 中的运行时 Group。 */
    list(): Promise<DesktopGroupSummary[]>;
    /** 创建并注册一个运行时 Group。 */
    create(input: DesktopCreateGroupInput): Promise<DesktopGroupSummary>;
    /** 根据自然语言描述生成一份可编辑的 Group 草稿。 */
    generate_draft(input: DesktopGenerateGroupDraftInput): Promise<DesktopGroupDraft>;
    /** 更新一个已保存的 Group 定义。 */
    update(group_id: string, input: DesktopUpdateGroupInput): Promise<DesktopGroupSummary>;
    /** 删除一个已保存的 Group。 */
    remove(group_id: string): Promise<boolean>;
    /** 打开一个运行时 Group。 */
    open(group_id: string, session_id?: string): Promise<DesktopGroupSummary>;
    /** 列出指定 Group 的 GroupSession 摘要。 */
    list_sessions(group_id: string): Promise<DesktopGroupSessionSummary[]>;
    /** 创建指定 Group 的新 GroupSession。 */
    create_session(group_id: string, workspace_id?: string): Promise<DesktopGroupSummary>;
    /** 修改指定 GroupSession 的 canonical 标题。 */
    rename_session(group_id: string, session_id: string, title: string): Promise<string>;
    /** 读取 Group 的共享消息。 */
    list_messages(group_id: string, session_id?: string): Promise<DesktopGroupMessage[]>;
    /** 向 Group 发言并驱动成员 Agent 执行。 */
    send(group_id: string, session_id: string | undefined, input: DesktopGroupSendInput): Promise<{ turn_id?: string }>;
    /** 停止 Group 当前执行。 */
    stop(group_id: string, session_id?: string): Promise<void>;
    /** 响应 Group 成员 Agent Session 的交互请求。 */
    respond_interaction(group_id: string, session_id: string, input: RespondSessionInteractionInput): Promise<void>;
    /** 删除指定 GroupSession。 */
    remove_session(group_id: string, session_id: string): Promise<DesktopGroupSummary>;
    /** 订阅 GroupSession 的统一消息与状态事件。 */
    subscribe(callback: (event: DesktopGroupEvent) => void): () => void;
  };
  /** Desktop 用户级设置。 */
  settings: {
    /** 读取当前设置。 */
    get(): Promise<DesktopSettings>;
    /** 合并并保存设置。 */
    update(patch: Partial<DesktopSettings>): Promise<DesktopSettings>;
    /** 读取 Global Env。 */
    list_env(): Promise<string>;
    /** 保存 Global Env。 */
    update_env(raw: string): Promise<string>;
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
