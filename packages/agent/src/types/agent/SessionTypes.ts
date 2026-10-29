/**
 * Agent session 数据类型。
 *
 * 关键点（中文）
 * - 只描述 session 的输入、摘要、历史、system snapshot 与配置快照。
 * - session actor 方法接口拆到 `SessionActor.ts`。
 */

import type { ModelClient } from "@downcity/type";
import type { SessionApprovalMode } from "@downcity/type";
import type { SessionOrigin } from "@downcity/type";
import type { WorkspaceRuntime } from "@downcity/type";
import type {
  SessionSystemBlock,
  SessionSystemBlockSource,
} from "@downcity/type/session";

/**
 * 新建 Session 的输入参数。
 *
 * Session ID 由 AgentSessions 在创建时生成，调用方只能在恢复时通过
 * `sessions.get(session_id)` 指定已有 ID。
 */
export interface AgentCreateSessionInput {
  /**
   * 当前 Session 的创建来源。
   *
   * 省略时使用默认工作会话（`work` 分类、`work` 角色）；调用方也可以声明
   * 自己的角色，但必须同时给出所在分类。
   */
  readonly origin?: SessionOrigin;
}

/**
 * Session 列表查询输入。
 */
export interface AgentListSessionsInput {
  /** 要查询的来源分类；省略时查询 `work` 分类。 */
  category?: string;
  /**
   * 分类内按角色过滤；省略时返回该分类的全部会话。
   *
   * 用于区分同一分类下的不同角色，例如在 `chat` 分类里只看 Agent 主会话。
   */
  origin_type?: string;
  /**
   * 只返回绑定到指定 Workspace 的 Session。
   *
   * 省略时查询当前 Agent 的全部 Session；传入时没有 Workspace metadata 的
   * 历史 Session 不会匹配任何 Workspace。
   */
  workspace_id?: string;

  /**
   * 当前页返回上限。
   *
   * 说明（中文）
   * - 省略时由 SDK 使用默认值。
   * - 建议宿主 UI 明确传入，避免在大量 session 下拉取过多数据。
   */
  limit?: number;

  /**
   * 绑定 Store 与查询条件的不透明快照游标。
   *
   * 本地快照两分钟后过期，也可能因容量淘汰、删除、归档、清空或 Store 释放提前失效。
   * 调用方仅原样透传，不解析或持久化；收到 session_list_cursor_expired 时从首页重启。
   */
  cursor?: string;

  /**
   * 关键词过滤。
   *
   * 说明（中文）
   * - 推荐用于匹配 `session_id`、标题与预览文本。
   * - 属于轻量包含匹配，不承诺复杂搜索语义。
   */
  query?: string;
}

/**
 * Session 可变配置。
 */
export interface AgentSessionSetInput {
  /**
   * 当前 session 默认模型实例。
   *
   * 关键点（中文）
   * - SDK 只接受宿主已经解析完成的运行时模型实例。
   * - 模型选择、ID 与持久化全部由宿主负责。
   */
  model?: ModelClient;

  /**
   * 当前 Session 的安全策略。
   *
   * 关键点（中文）
   * - configured 值在 `set()` 返回前被 Session 接受。
   * - 执行面在下一 Session Step 检查点原子提交该值。
   */
  security?: AgentSessionSecurityConfig;

  /**
   * 当前 Session 的工作目录。
   *
   * 关键点（中文）
   * - 与 `model` 同级：只接受宿主持有的运行时实例，持久化的是它的 `id`。
   * - 传空值表示脱离项目上下文；此时没有文件工具与 Shell，但纯模型对话仍可用。
   * - 不迁移已有消息、附件与工具结果；它们属于发生时的目录。
   * - 执行中的 Turn 沿用旧目录，从下一 Step 检查点起生效。
   */
  workspace?: WorkspaceRuntime | null;
}

/** Session 配置提交后的 Action 可观测性选项。 */
export interface AgentSessionSetOptions {
  /**
   * 是否把真实配置变化持久化为包含 completed Action Part 的 Agent Message。
   *
   * 关键点（中文）
   * - 默认值为 true。
   * - 设为 false 只关闭 Action Part 历史，不影响配置写入与检查点提交。
   * - 适用于 Session 初始化、恢复与其他不应进入时间线的宿主装配流程。
   */
  persist_action?: boolean;

  /**
   * 是否在 Action Part 所属 Agent Message 持久化成功后发布对应 Session Mutation。
   *
   * 关键点（中文）
   * - 默认跟随 `persist_action`。
   * - 只有 `persist_action=true` 时才允许设为 true，避免发布不存在于 canonical Message 历史中的事件。
   */
  publish_mutation?: boolean;
}

/** 可通过本地或远程 Session 动态更新的安全策略。 */
export interface AgentSessionSecurityConfig {
  /** 高风险操作是否需要用户逐次审批。 */
  approval_mode: SessionApprovalMode;
}

/** 远程 Session 可序列化的动态配置输入。 */
export interface RemoteSessionSetInput {
  /**
   * 当前远程 Session 使用的宿主模型 ID。
   *
   * 关键点（中文）
   * - 远程边界只传递稳定、可序列化的模型 ID。
   * - 服务端宿主负责把模型 ID 解析为运行时 ModelClient。
   */
  model_id?: string;

  /** 当前远程 Session 的安全策略。 */
  security?: AgentSessionSecurityConfig;
}

/** Session 当前安全状态。 */
export interface AgentSessionSecurityStatus {
  /** Session 已接受的 configured 审批模式。 */
  approval_mode: SessionApprovalMode;
  /** 执行面在最近 Step 检查点提交的审批模式。 */
  effective_approval_mode: SessionApprovalMode;
}

/** Session 当前运行状态。 */
export interface AgentSessionStatus {
  /** 当前状态所属 Session 标识。 */
  session_id: string;
  /** Session 当前是否正在执行 Turn。 */
  state: "idle" | "running";
  /** 当前正在执行的 Turn 标识；空闲时省略。 */
  active_turn_id?: string;
  /** 当前 Turn 的普通输入占用对象，空闲时为 null。 */
  occupied_by?: import("../sdk/SessionPromptActor.js").SessionPromptActor | null;
  /** 当前 Session 的安全状态。 */
  security: AgentSessionSecurityStatus;
}

/**
 * Session 当前配置快照。
 */
export interface AgentSessionConfigSnapshot {
  /** 当前 session 绑定的默认模型实例。 */
  model?: ModelClient;
  /** 当前模型的轻量可读标签。 */
  model_label?: string;
  /** 当前模型支持的总上下文窗口长度，单位为 token。 */
  model_context_window?: number;
}

/**
 * Session 时间线事件。
 */
export interface AgentSessionTimelineEvent {
  /** 当前事件唯一标识。 */
  id: string;
  /**
   * 当前事件角色。
   *
   * 说明（中文）
   * - `tool-call` / `tool-result` 用于把 assistant 内部工具过程平铺给 UI。
   */
  role: "user" | "agent" | "tool-call" | "tool-result" | "action";
  /** 事件时间戳（毫秒）。 */
  ts?: number;
  /** 事件所属消息种类。 */
  kind?: string;
  /** 事件来源。 */
  source?: string;
  /** 当前事件展示文本。 */
  text: string;
  /**
   * 当前事件对应工具名称。
   *
   * 说明（中文）
   * - 仅 `tool-call` / `tool-result` 这类事件通常会携带该字段。
   */
  tool_name?: string;
  /**
   * 当前 action 标题。
   *
   * 说明（中文）
   * - 仅 `role=action` 的事件通常会携带该字段。
   */
  action_title?: string;
  /**
   * 当前 action 描述。
   *
   * 说明（中文）
   * - 仅 `role=action` 的事件通常会携带该字段。
   */
  action_description?: string;
  /**
   * 当前 action 状态。
   *
   * 说明（中文）
   * - 仅 `role=action` 的事件通常会携带该字段。
   */
  action_state?: string;
}

/**
 * Session system block 来源类型。
 */
export type AgentSessionSystemBlockSource = SessionSystemBlockSource;

/**
 * Session system prompt 的单个组成块。
 */
export type AgentSessionSystemBlock = SessionSystemBlock;

/**
 * 当前 session 的稳定上下文信息。
 */
export interface AgentSessionSystemSessionInfo {
  /** 当前 session 所属 agent_id。 */
  agent_id: string;
  /** 当前 session 唯一标识。 */
  session_id: string;
  /** 当前 agent 绑定的项目根目录。 */
  project_root: string;
  /**
   * 当前 session 首次创建时间。
   *
   * 关键点（中文）
   * - 这是 session 初始化时落盘的稳定参考时间，按 Date/ISO 字符串对外展示。
   * - 它不是每轮运行的当前时间，不会随着后续 turn 执行而改变。
   */
  created_at: string;
  /**
   * 当前 session 初始化时解析到的系统时区。
   *
   * 关键点（中文）
   * - 这是 session 级参考时区，随创建信息一起固定。
   * - 它不是每轮运行重新解析的动态时区。
   */
  timezone: string;
}

/**
 * 当前 session 首次生成后固定的完整 system prompt 快照。
 */
export interface AgentSessionSystemSnapshot {
  /** 当前 session_id。 */
  session_id: string;
  /**
   * 当前 session 的稳定上下文信息。
   *
   * 关键点（中文）
   * - 这里包含 session 创建时间这类稳定参考信息。
   * - 这里不包含当前时间、轮次、用户输入等每轮变化的数据。
   * - 每轮动态信息应由调用方放入 user message，避免破坏 instruction 缓存命中。
   */
  session: AgentSessionSystemSessionInfo;
  /** 首次生成后固定的 system blocks，按进入模型的顺序排列。 */
  blocks: AgentSessionSystemBlock[];
}

/**
 * Session 摘要。
 */
export interface AgentSessionSummary {
  /** 当前 session 所属 agent_id。 */
  agent_id: string;
  /** 当前 session 唯一标识。 */
  session_id: string;
  /**
   * 当前 session 可读标题。
   *
   * 说明（中文）
   * - 标题持久化在 Session SQLite 的 `session_state` 中。
   * - SDK 只在模型成功生成标题时写入，不再从首条用户消息生成 fallback。
   * - 标题允许为空，调用方需要展示占位文案时可自行回退到 `session_id`。
   */
  title?: string;
  /**
   * 当前 session 的最近预览文本。
   *
   * 说明（中文）
   * - 通常来自最后一条用户可见消息的裁剪文本。
   * - 适合用于侧边栏、列表卡片或 session picker。
   */
  preview_text?: string;
  /** 当前 session 首次创建时间（ms）。 */
  created_at?: number;
  /** 当前 session 最近一次更新时间（ms）。 */
  updated_at?: number;
  /** 当前 session 已落盘消息数。 */
  message_count: number;
  /** 当前 session 绑定模型的可读标签。 */
  model_label?: string;
  /** 当前 Session 的创建来源。 */
  origin: SessionOrigin;
  /** 当前 Session 绑定的 Workspace ID；未绑定时为空。 */
  workspace_id?: string;
  /** 当前 session 是否处于执行中。 */
  executing?: boolean;
}

/**
 * Session 详情。
 */
export interface AgentSessionInfo extends AgentSessionSummary {
  /** 当前 session 初始化时记录的时区。 */
  timezone?: string;
}

/**
 * Session 摘要分页结果。
 */
export interface AgentSessionSummaryPage {
  /** 当前页 session 摘要列表。 */
  items: AgentSessionSummary[];
  /**
   * 当前页所对应的总条数。
   *
   * 说明（中文）
   * - 这里表示过滤后的总数，不是仅当前页数量。
   * - 对分页 UI、结果统计和空态判断更友好。
   */
  total: number;
  /** 同一查询快照的下一页不透明游标；末页省略。 */
  next_cursor?: string;
  /** 是否仍有更多结果。 */
  has_more: boolean;
}

/**
 * Session fork 输入。
 */
export interface AgentSessionForkInput {
  /**
   * 可选分叉锚点消息 ID。
   *
   * 关键点（中文）
   * - 省略时复制当前 session 的完整消息历史。
   * - 传入时复制到该消息为止（包含该消息）。
   */
  message_id?: string;
  /**
   * 是否将 `message_id` 指向的锚点消息复制到新 Session。
   *
   * 省略时默认为 `true`；编辑并重新发送历史消息时传入 `false`，避免新旧消息同时出现。
   */
  include_message?: boolean;
  /**
   * 是否直接在当前 Session 截断历史并返回当前实例。
   *
   * 默认 `false`，创建新分支；`true` 时保留当前身份与配置，不写操作记录。
   * 未指定锚点时不改变历史；当前 Session 正在执行或有排队命令时拒绝替换。
   */
  replace?: boolean;
}

/**
 * 归档 Session 及当前 Agent 下全部后代 Work Session 的输入参数。
 */
export interface AgentArchiveSessionInput {
  /**
   * 要归档的 session id。
   *
   * 关键点（中文）
   * - 必须指向当前 agent 下已存在的未归档 session。
   * - 当前 Session 或任一后代正在执行或有排队输入时，不允许归档。
   * - 先归档后代，再归档当前 Session；存储失败时已归档的后代不回滚，可重试剩余节点。
   */
  id: string;
  /** Session 所在的来源分类；省略时使用 `work`。 */
  category?: string;
}

/**
 * 列出已归档 session 的输入参数。
 */
export interface AgentArchiveSessionsInput {
  /** 要查询的来源分类；省略时查询 `work` 分类。 */
  category?: string;
  /**
   * 只返回绑定到指定 Workspace 的归档 Session。
   *
   * 省略时查询当前 Agent 的全部归档 Session；传入时没有 Workspace metadata
   * 的历史 Session 不会匹配任何 Workspace。
   */
  workspace_id?: string;

  /**
   * 当前页返回上限。
   *
   * 说明（中文）
   * - 省略时由 SDK 使用默认值。
   */
  limit?: number;

  /**
   * 绑定 Store 与归档查询条件的不透明快照游标。
   *
   * 本地快照两分钟后过期，也可能提前淘汰或失效；仅原样透传，不解析或持久化。
   * 收到 session_list_cursor_expired 时丢弃部分结果并从首页重新查询。
   */
  cursor?: string;

  /**
   * 关键词过滤。
   *
   * 说明（中文）
   * - 推荐用于匹配 `session_id`、标题与预览文本。
   * - 属于轻量包含匹配，不承诺复杂搜索语义。
   */
  query?: string;
}

/**
 * 归档单个 session 的结果。
 */
export interface AgentArchiveSessionResult {
  /** 被归档的 session id。 */
  session_id: string;
  /** 归档时间戳（ms）。 */
  archived_at: number;
}

/**
 * 列出已归档 session 的结果。
 */
export interface AgentArchiveSessionsResult extends AgentSessionSummaryPage {}

/**
 * 清空归档目录的结果。
 */
export interface AgentCleanArchiveResult {
  /** 被永久删除的归档 session id 列表。 */
  removed_session_ids: string[];
}
