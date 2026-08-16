/**
 * Chat Access 领域类型。
 *
 * 关键点（中文）
 * - Chat Access 只负责外部聊天用户进入当前 Agent 前的准入判定。
 * - 用户唯一身份由 channel、issuer、subject_id 共同确定。
 * - `all` 仅用于管理命令输入，持久化时展开为 direct/group 两条明确记录。
 */

import type { ChatDispatchChannel } from "@/chat/types/ChatDispatcher.js";

/** Chat Plugin 对外暴露的 Access Action。 */
export const CHAT_ACCESS_ACTIONS = {
  /** 读取 Principal、Grant 和 Request 快照。 */
  snapshot: "access-snapshot",
  /** 批准待处理 Request。 */
  approve: "access-approve",
  /** 拒绝待处理 Request。 */
  deny: "access-deny",
  /** 直接设置已知 Principal 的 Access。 */
  set: "access-set",
  /** 撤销已知 Principal 的 Access。 */
  revoke: "access-revoke",
} as const;

/** Chat Access 支持的消息范围。 */
export type ChatAccessScope = "direct" | "group";

/** Chat Access 管理入口支持的范围。 */
export type ChatAccessScopeInput = ChatAccessScope | "all";

/** Chat Access Grant 效果。 */
export type ChatAccessEffect = "allow" | "deny";

/** Chat Access Request 状态。 */
export type ChatAccessRequestStatus =
  | "pending"
  | "approved"
  | "denied"
  | "expired";

/** Chat Access 判定原因。 */
export type ChatAccessDecisionReason =
  | "grant_allowed"
  | "grant_denied"
  | "request_pending"
  | "identity_missing";

/**
 * Chat 平台提供的原始身份与消息来源。
 */
export interface ChatAccessIdentityInput {
  /** 当前消息来源渠道。 */
  channel: ChatDispatchChannel;
  /** 当前 Bot/App 的稳定账号标识，不得包含密钥。 */
  issuer: string;
  /** 平台用户稳定 ID。 */
  subject_id: string;
  /** 用户展示名称。 */
  display_name?: string;
  /** 当前平台会话 ID。 */
  chat_id: string;
  /** 当前平台会话类型。 */
  chat_type?: string;
  /** 当前会话展示名称。 */
  chat_title?: string;
}

/**
 * Chat Access 内部规范化主体。
 */
export interface ChatAccessPrincipal {
  /** 内部稳定主体 ID。 */
  principal_id: string;
  /** 当前主体来源渠道。 */
  channel: ChatDispatchChannel;
  /** 当前主体所在 Bot/App 账号边界。 */
  issuer: string;
  /** 平台用户稳定 ID。 */
  subject_id: string;
  /** 最近观测到的展示名称。 */
  display_name?: string;
  /** 首次观测时间。 */
  first_seen_at: string;
  /** 最近观测时间。 */
  last_seen_at: string;
  /** 最近发言会话 ID。 */
  last_chat_id?: string;
  /** 最近发言会话类型。 */
  last_chat_type?: string;
}

/**
 * Chat Access Grant。
 */
export interface ChatAccessGrant {
  /** Grant 稳定 ID。 */
  grant_id: string;
  /** 关联主体 ID。 */
  principal_id: string;
  /** Grant 适用范围。 */
  scope: ChatAccessScope;
  /** Allow 或 Deny。 */
  effect: ChatAccessEffect;
  /** 执行该变更的可信操作者。 */
  created_by: string;
  /** 创建时间。 */
  created_at: string;
  /** 最近更新时间。 */
  updated_at: string;
}

/**
 * Chat Access Request。
 */
export interface ChatAccessRequest {
  /** Request 稳定 ID。 */
  request_id: string;
  /** 关联主体 ID。 */
  principal_id: string;
  /** 请求准入范围。 */
  scope: ChatAccessScope;
  /** 触发请求的平台会话 ID。 */
  chat_id: string;
  /** 触发请求的平台会话类型。 */
  chat_type: string;
  /** 当前请求状态。 */
  status: ChatAccessRequestStatus;
  /** 解决该请求的可信操作者。 */
  resolved_by?: string;
  /** 创建时间。 */
  created_at: string;
  /** 最近一次重复请求时间。 */
  last_requested_at: string;
  /** 请求解决时间。 */
  resolved_at?: string;
}

/**
 * 带主体详情的请求展示项。
 */
export interface ChatAccessRequestView extends ChatAccessRequest {
  /** 当前请求对应主体。 */
  principal: ChatAccessPrincipal;
}

/**
 * 带 Grant 的主体展示项。
 */
export interface ChatAccessPrincipalView {
  /** 当前主体。 */
  principal: ChatAccessPrincipal;
  /** 当前主体所有 Grant。 */
  grants: ChatAccessGrant[];
}

/**
 * Chat Access 入站判定结果。
 */
export interface ChatAccessDecision {
  /** 是否允许进入 Agent。 */
  allowed: boolean;
  /** 归一化主体 ID；身份缺失时为空字符串。 */
  principal_id: string;
  /** 当前消息对应范围。 */
  scope: ChatAccessScope;
  /** 稳定判定原因。 */
  reason: ChatAccessDecisionReason;
  /** 未批准时创建或复用的 Request ID。 */
  request_id?: string;
}

/**
 * 批准请求输入。
 */
export interface ApproveChatAccessRequestInput {
  /** Request ID。 */
  request_id: string;
  /** 可选范围覆盖；默认使用请求自身范围。 */
  scope?: ChatAccessScopeInput;
  /** 执行批准的可信操作者。 */
  operator: string;
}

/**
 * 拒绝请求输入。
 */
export interface DenyChatAccessRequestInput {
  /** Request ID。 */
  request_id: string;
  /** 可选范围覆盖；默认使用请求自身范围。 */
  scope?: ChatAccessScopeInput;
  /** 执行拒绝的可信操作者。 */
  operator: string;
}

/**
 * 撤销 Grant 输入。
 */
export interface RevokeChatAccessGrantInput {
  /** Principal ID。 */
  principal_id: string;
  /** 要撤销的范围。 */
  scope: ChatAccessScopeInput;
  /** 执行撤销的可信操作者。 */
  operator: string;
}

/** ChatAccessService 构造参数。 */
export interface ChatAccessServiceOptions {
  /** 当前 AgentWorkspace 私有数据根目录。 */
  data_path: string;
}

/** 直接设置 Principal Grant 的输入。 */
export interface SetChatAccessPrincipalEffectInput {
  /** Principal 稳定 ID。 */
  principal_id: string;
  /** 要设置的 Chat 消息范围。 */
  scope: ChatAccessScopeInput;
  /** 要写入的 Allow/Deny 效果。 */
  effect: ChatAccessEffect;
  /** 执行设置的可信操作者。 */
  operator: string;
}

/** Store 新增或更新 Principal 的输入。 */
export interface UpsertChatAccessPrincipalInput {
  /** Principal 来源渠道。 */
  channel: ChatDispatchChannel;
  /** 当前 Bot/App 的稳定账号边界。 */
  issuer: string;
  /** 平台用户稳定 ID。 */
  subject_id: string;
  /** 最近观测到的展示名称。 */
  display_name?: string;
  /** 最近发言会话 ID。 */
  chat_id?: string;
  /** 最近发言会话类型。 */
  chat_type?: string;
  /** 迁移时提供的首次观测时间。 */
  first_seen_at?: string;
  /** 迁移时提供的最近观测时间。 */
  last_seen_at?: string;
}

/** Store 新增或更新 Grant 的输入。 */
export interface UpsertChatAccessGrantInput {
  /** 关联 Principal 稳定 ID。 */
  principal_id: string;
  /** Grant 适用范围。 */
  scope: ChatAccessScope;
  /** Grant 的 Allow/Deny 效果。 */
  effect: ChatAccessEffect;
  /** 执行变更的可信操作者。 */
  operator: string;
}

/** Store 创建或复用 Request 的输入。 */
export interface CreateChatAccessRequestInput {
  /** 关联 Principal 稳定 ID。 */
  principal_id: string;
  /** 请求准入范围。 */
  scope: ChatAccessScope;
  /** 触发请求的平台会话 ID。 */
  chat_id: string;
  /** 触发请求的平台会话类型。 */
  chat_type?: string;
}

/** Store 创建或复用 Request 的结果。 */
export interface CreateChatAccessRequestResult {
  /** 创建或复用后的 Request。 */
  request: ChatAccessRequest;
  /** 本次是否创建了新 Request。 */
  created: boolean;
}

/** Store 解决单个 Request 的输入。 */
export interface ResolveChatAccessRequestStoreInput {
  /** 要解决的 Request ID。 */
  request_id: string;
  /** Request 最终状态。 */
  status: "approved" | "denied";
  /** 执行操作的可信操作者。 */
  operator: string;
}

/** Store 批量解决 Principal pending Request 的输入。 */
export interface ResolvePendingChatAccessRequestsInput {
  /** 关联 Principal 稳定 ID。 */
  principal_id: string;
  /** 要解决的明确范围集合。 */
  scopes: ChatAccessScope[];
  /** Request 最终状态。 */
  status: "approved" | "denied";
  /** 执行操作的可信操作者。 */
  operator: string;
}

/** Store 写入审计事件的输入。 */
export interface InsertChatAccessAuditEventInput {
  /** 可选关联 Principal ID。 */
  principal_id?: string;
  /** 可选关联 Request ID。 */
  request_id?: string;
  /** 稳定审计动作名称。 */
  action: string;
  /** 可选 Chat 消息范围。 */
  scope?: ChatAccessScope;
  /** 可选判定或 Grant 效果。 */
  decision?: string;
  /** 可选可信操作者。 */
  operator?: string;
  /** 可选结构化审计详情。 */
  detail?: Record<string, unknown>;
}

/**
 * 请求列表过滤条件。
 */
export interface ListChatAccessRequestsInput {
  /** 可选状态过滤。 */
  status?: ChatAccessRequestStatus;
}

/**
 * Chat Access 快照。
 */
export interface ChatAccessSnapshot {
  /** 当前 Principal 列表。 */
  principals: ChatAccessPrincipalView[];
  /** 当前 Request 列表。 */
  requests: ChatAccessRequestView[];
}
