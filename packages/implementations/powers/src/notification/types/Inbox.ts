/** Inbox视图的临时展示状态；业务事实仍来自Notification与原Session。 */
import type { NotificationItem } from "./Notification.js";
import type { NotificationInteractionItem, NotificationListResult } from "./NotificationRenderer.js";

/** 当前列表视图。 */
export type InboxView = "pending" | "updates";

/** 统一的列表与详情投影，不保存用户输入或私密值。 */
export interface InboxEntry {
  /** 完整来源生成的稳定选择标识。 */
  key: string;
  /** 列表所属视图。 */
  view: InboxView;
  /** 用户可读标题。 */
  title: string;
  /** 主体名称或业务来源。 */
  source: string;
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

/** Sidebar和Mainview共用的只读快照。 */
export interface InboxState {
  /** 最近一次成功读取的原业务快照。 */
  data?: NotificationListResult;
  /** 首次读取是否尚未完成。 */
  loading: boolean;
  /** 读取失败的安全说明，失败不清除已有内容。 */
  error: string;
  /** 两个列表当前选中项，保留已处理项目以便原位确认。 */
  selected: Partial<Record<InboxView, InboxEntry>>;
  /** 已在本页面成功回应的项目标识。 */
  handled: ReadonlySet<string>;
  /** 当前表单存在未提交修改的项目，不保存输入内容。 */
  dirty_key?: string;
  /** 正在提交回答或打开来源的项目。 */
  busy_key?: string;
}
