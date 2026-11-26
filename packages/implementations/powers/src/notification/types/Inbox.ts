/** Inbox视图的临时展示状态；业务事实仍来自Notification与原Session。 */
import type { NotificationItem } from "./Notification.js";
import type { NotificationInteractionItem, NotificationListResult } from "./NotificationRenderer.js";

/** 当前列表视图。 */
export type InboxView = "pending" | "updates" | "all";

/** 统一的列表与详情投影，不保存用户输入或私密值。 */
export interface InboxEntry {
  /** 完整来源生成的稳定选择标识。 */
  key: string;
  /** 项目的原始类别；筛选视图可同时展示请求和更新。 */
  view: "pending" | "updates";
  /** 安全的纯文本摘要，只投影问题文字或公开通知正文。 */
  summary: string;
  /** 用户可读标题。 */
  title: string;
  /** 主体名称或业务来源。 */
  source: string;
  /** 原请求或通知的真实 Agent 标识，供宿主解析头像；纯 Power 更新不设置此字段。 */
  agent_id?: string;
  /** 交互或通知产生的时间。 */
  created_at: number;
  /** 列表展示的语义类别。 */
  kind: "question" | "approval" | "secret" | "update";
  /** 更新是否未读，或请求仍需用户关注。 */
  unread: boolean;
  /** 原始请求引用，仅交互项存在。 */
  pending?: NotificationInteractionItem;
  /** 原始通知引用，仅更新项存在。 */
  update?: NotificationItem;
}

/** 资源页和详情共用的只读快照。 */
export interface InboxState {
  /** 最近一次成功读取的原业务快照。 */
  data?: NotificationListResult;
  /** 首次读取是否尚未完成。 */
  loading: boolean;
  /** 读取失败的安全说明，失败不清除已有内容。 */
  error: string;
  /** 当前选中事项，保留已处理请求以便原位确认；首次进入不自动选择。 */
  selected?: InboxEntry;
  /** 已在本页面成功回应的项目标识。 */
  handled: ReadonlySet<string>;
  /** 当前表单存在未提交修改的项目，不保存输入内容。 */
  dirty_key?: string;
  /** 正在执行的普通更新动作；禁用重复提交，独立于原 Interaction 表单。 */
  update_action?: string;
  /** 普通更新动作失败的可读说明；不替换已有快照。 */
  update_error?: string;
  /** 正在提交回答或打开来源的项目。 */
  busy_key?: string;
}
