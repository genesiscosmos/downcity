/**
 * Inbox Renderer 的只读输入与受信宿主表单端口。
 * 普通响应由 Notification Power 代理，私密值只交给宿主专用入口。
 */
import type { ReactNode } from "react";
import type { PowerNotificationTarget, PowerNotificationKind, PowerNotificationAvailability, PowerNotificationScope, PowerNotificationOutcome } from "@downcity/city/power";
import type { AgentInteraction } from "@downcity/agent";
import type { RespondSessionInteractionInput } from "@downcity/type";
import type { NotificationItem } from "./Notification.js";

/** 一个 Agent 原交互及其展示身份。 */
export interface NotificationInteractionItem {
  /** 原交互所属 Agent 的稳定标识。 */
  agent_id: string;
  /** 当前 Agent 的用户可见名称。 */
  agent_name: string;
  /** 原 Session canonical 快照、完整来源引用与 can_respond；为 false 时仅展示中断提示，禁止挂载可提交表单。 */
  interaction: AgentInteraction;
  /** 当前用户可打开的来源目标；Group 成员映射到群聊。 */
  target?: PowerNotificationTarget;
  /** 原主体未提供来源时为 unknown；不会因目录缺失丢弃请求。 */
  availability: PowerNotificationAvailability;
}

/** 一个仍需用户注意的稳定引用；这是快照投影，不是另一份通知存储。 */
export interface NotificationAttention {
  /** 普通更新标识或原 Interaction 的完整稳定引用键。 */
  notification_id: string;
  /** 产生此提示的稳定主题键。 */
  topic_key: string;
  /** 统一注意力类别。 */
  kind: PowerNotificationKind;
  /** 来源业务对象的稳定目标。 */
  target?: PowerNotificationTarget;
  /** 事实来源类别，未知原请求来源保留 unknown。 */
  source_kind: "session" | "group" | "power" | "unknown";
  /** Inbox 与会话未读的统一投影范围。 */
  scope: PowerNotificationScope;
  /** 明确的业务结果。 */
  outcome: PowerNotificationOutcome;
  /** 可达性不改变原记录或请求状态。 */
  availability: PowerNotificationAvailability;
  /** 用户可见标题。 */
  title: string;
  /** 安全摘要，不包含私密答案。 */
  body?: string;
  /** 来源创建时间，毫秒。 */
  created_at: number;
}

/** notification.list 返回的完整 Inbox 快照。 */
export interface NotificationListResult {
  /** Power 生命周期内单调递增版本；所有消费者共享此版本。 */
  revision: number;
  /** 可响应的原 Interaction 数量；已中断或暂不可响应的请求不计入。 */
  pending_request_count: number;
  /** scope=inbox 的全部普通未读更新数，包括 success、info 和 failure。 */
  unread_update_count: number;
  /** scope=inbox 的普通未读失败事项数，是 unread_update_count 的子集。 */
  unread_failure_count: number;
  /** 应用与 Inbox 导航的最终数字：pending_request_count + unread_failure_count。 */
  badge_count: number;
  /** 全部未读与可响应请求投影；消费方按 scope 区分会话和 Inbox。 */
  notifications: NotificationAttention[];
  /** 暂时无法核对目标目录的 Group，不能据此清理其状态。 */
  unavailable_groups: string[];
  /** 当前主体目录的显示名称；更新来源独立于是否存在待处理请求。 */
  agent_names: Record<string, string>;
  /** 普通更新；已读状态由 Notification Power 持久化。 */
  items: NotificationItem[];
  /** 当前所有 Agent 尚待处理的原交互。 */
  interactions: NotificationInteractionItem[];
  /** 暂时无法查询的 Agent；界面必须提示部分结果不可用。 */
  unavailable_agents: string[];
}

/** 普通更新动作提交后的权威快照，列表和计数整体更新。 */
export interface NotificationUpdateResult {
  /** 已完成的操作类别；版本失配时动作安全跳过，快照反映实际保留内容。 */
  status: "read" | "cleared";
  /** 操作提交后读取的完整 Power 快照，消费方按 revision 拒绝迟到结果。 */
  snapshot: NotificationListResult;
}

/** 宿主表单与详情共享的标题，避免在独立处理页重复显示同一问题。 */
export interface NotificationInteractionDisplay {
  /** 详情标题元素的 DOM 标识；省略相同表单标题时用于可访问名称。 */
  title_id: string;
  /** 详情已经展示的完整标题；多问题仍保留不同的当前问题提示。 */
  title: string;
}

/** 宿主用同一套导航注意力规则展示 Inbox 状态，不接收业务修改权限。 */
export interface NotificationAttentionDisplay {
  /** 可响应请求为 request，普通通知为 update；已中断请求不会调用此端口。 */
  kind: "request" | "update";
  /** 原始业务结果；阅读操作不改变此值。 */
  outcome: PowerNotificationOutcome;
  /** dot 表示仍需注意，status 表示业务状态文字。 */
  presentation: "dot" | "status";
  /** 由 Inbox 提供的可读状态，同时作为圆点的辅助技术名称。 */
  label: string;
}

/** 宿主可选注入现有 Interaction 控件、Agent 头像及专用私密传输。 */
export interface NotificationRendererOptions {
  /** 用户明确查看时打开原Session；只传引用，不提供新执行权限。 */
  open_interaction?: (item: NotificationInteractionItem) => Promise<void>;
  /** 用户明确查看时打开通知关联的结果或业务页面。 */
  open_notification?: (item: NotificationItem) => Promise<void>;
  /** 仅为 can_respond 为 true 的原请求挂载表单；控件提交时须标明是否包含私密问题。 */
  render_interaction?: (item: NotificationInteractionItem, respond: (input: RespondSessionInteractionInput, private_question?: boolean) => Promise<void>, display: NotificationInteractionDisplay) => ReactNode;
  /** 由受信宿主解析真实 Agent 头像；list 为 32px 独立头像列，detail 为 18px 来源行；不暴露本地路径或加载策略。 */
  render_agent_avatar?: (agent_id: string, size: "list" | "detail") => ReactNode;
  /** 复用宿主 Rail 的状态映射与语义配色；未提供时使用中性展示。 */
  render_attention?: (display: NotificationAttentionDisplay) => ReactNode;
  /** 受信宿主直接提交到原 Session，禁止转发到普通 Power action。 */
  submit_private?: (item: NotificationInteractionItem, input: RespondSessionInteractionInput) => Promise<void>;
}
