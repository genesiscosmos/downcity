/**
 * Agent session 数据类型。
 *
 * 关键点（中文）
 * - 只描述 session 的输入、摘要、历史、system snapshot 与配置快照。
 * - session actor 方法接口拆到 `SessionActor.ts`。
 */

import type { ModelClient, SessionApprovalMode, SessionDescriptor } from "@downcity/type";
import type { SessionSystemBlock, SessionSystemBlockSource } from "@downcity/type/session";

/**
 * 新建 Session 的输入参数。
 *
 * Session ID 由 AgentSessions 在创建时生成，调用方只能在恢复时通过
 * `sessions.get(session_id)` 指定已有 ID。
 */
export interface AgentCreateSessionInput extends Partial<SessionDescriptor> {
  /** 可选的用户可见标题，与会话目录记录在同一创建事务中保存。 */
  readonly title?: string;

}

/**
 * Session 列表查询输入。
 */
export interface AgentListSessionsInput {
  /** 要查询的来源分类；省略时查询 `work` 分类。 */
  type?: string;
  /**
   * 分类内按角色过滤；省略时返回该分类的全部会话。
   *
   * 用于区分同一分类下的不同角色，例如在 `chat` 分类里只看 Agent 主会话。
   */
  kind?: string;
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
   * 绑定 Agent、存储世代和完整过滤条件的不透明 keyset 游标。
   *
   * 翻页间不冻结快照；更新后的记录可能移到前页，调用方按 session_id 去重。
   * 原样透传，收到 session_list_cursor_invalid 时从首页重新查询。
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
   * 当前 Session 的安全策略。
   *
   * 关键点（中文）
   * - configured 值在 `set()` 返回前被 Session 接受。
   * - 执行面在下一 Session Step 检查点原子提交该值。
   */
  security?: AgentSessionSecurityConfig;
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
export type AgentSessionStatus = import("@downcity/type").SessionRuntimeSnapshot & {
  /** 当前 Session 的稳定标识。 */
  id: string;
  /** 当前 Turn 的普通输入占用对象，空闲时为 null。 */
  occupied_by?: import("../sdk/SessionPromptActor.js").SessionPromptActor | null;
  /** 当前 Session 的安全状态。 */
  security: AgentSessionSecurityStatus;
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
  role: "user" | "agent" | "tool-call" | "tool-result" | "action" | "input";
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
  /** 当前 session 唯一标识。 */
  id: string;
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
 * 当前 Session 的有效 system 预览：冻结的基础快照与本次 Composer 动态上下文。
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
  /** 基础快照与当前动态 system blocks，按进入模型的顺序排列；动态内容不参与 snapshot 持久化。 */
  blocks: AgentSessionSystemBlock[];
}

/**
 * Session 摘要。
 */
export interface AgentSessionSummary extends SessionDescriptor {
  /** 当前 session 唯一标识。 */
  id: string;
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
  /** 会话活动时间（ms）：初始为创建时间，仅由 User 消息创建或 Agent 消息首次终态推进。 */
  updated_at?: number;
  /** 当前 session 已落盘消息数。 */
  message_count: number;
  /** 当前 session 绑定模型的可读标签。 */
  model_label?: string;

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
  /** 当前查询的下一页不透明 keyset 游标；末页省略，不承诺跨页冻结快照。 */
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
  /** 归档操作UUID，省略创建新操作；失败后必须复用原ID恢复原计划。 */
  operation_id?: string;
  /** 可选原根UUID，提供时与持久化计划核对，不按逻辑新记录替代。 */
  root_session_id?: string;
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
  type?: string;
}

/**
 * 列出已归档 session 的输入参数。
 */
export interface AgentArchiveSessionsInput {
  /** 按创建入口或工作用途过滤；游标与该条件绑定。 */
  kind?: string;
  /** 要查询的来源分类；省略时查询 `work` 分类。 */
  type?: string;
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
   * 绑定 Agent、存储世代和归档过滤条件的不透明 keyset 游标。
   *
   * 仅原样透传；归档条目以 session_id 去重，恢复数据库后旧游标失效。
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
  /** 原操作UUID，允许确认丢失或部分失败后恢复固定计划。 */
  operation_id?: string;
  /** 原根不可变UUID。 */
  root_session_id?: string;
  /** 已持久化后序计划SHA-256，用于核对恢复句柄。 */
  plan_fingerprint?: string;
  /** 被归档的 session id。 */
  session_id: string;
  /** 本次实际移动根节点的归档时间戳（ms）；根已归档的幂等重试省略，不伪造原始时间。 */
  archived_at?: number;
  /** SDK 子树操作实际移动了节点；单 Store 归档结果可省略。 */
  changed?: boolean;
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
