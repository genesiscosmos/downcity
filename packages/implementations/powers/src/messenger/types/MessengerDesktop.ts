/** Messenger Power Desktop Sidebar/Mainview 使用的序列化 View 类型。 */

import type { PowerHostAgent, PowerHostWorkspace } from "@downcity/city/power";
import type { MessengerAccountView } from "./MessengerAccount.js";
import type { MessengerActivityRecord, MessengerConversationRecord } from "./MessengerReliability.js";
import type { MessengerAccessSnapshot } from "./MessengerAccess.js";

/** Messenger Desktop 工作区的完整快照。 */
export interface MessengerDesktopSnapshot {
  /** 当前配置的全部 Bot Account。 */
  accounts: MessengerAccountView[];
  /** 用户可以选择的 Agent。 */
  agents: PowerHostAgent[];
  /** 用户可以选择的 Workspace。 */
  workspaces: PowerHostWorkspace[];
}

/** 单个 Bot Account 详情快照。 */
export interface MessengerAccountDetailSnapshot {
  /** 当前 Bot Account。 */
  account: MessengerAccountView;
  /** 当前 Account 拥有的 Conversation。 */
  conversations: MessengerConversationRecord[];
  /** 当前 Account 最近的诊断 Activity。 */
  activity: MessengerActivityRecord[];
  /** 当前 Account 边界内的准入主体与申请。 */
  access: MessengerAccessSnapshot;
  /** 当前需要人工重试的可靠消息失败项，不包含消息正文。 */
  reliability_failures: MessengerReliabilityFailure[];
}

/** Desktop 可安全展示的一条 Inbox 或 Outbox 失败摘要。 */
export interface MessengerReliabilityFailure {
  /** 失败发生在入站执行还是平台投递。 */
  direction: "inbox" | "outbox";
  /** Inbox/Outbox 中的稳定任务 ID。 */
  item_id: string;
  /** 相关 Conversation ID；入站尚未完成路由时可以为空。 */
  conversation_id?: string;
  /** 已执行或投递的次数。 */
  attempt_count: number;
  /** 最近一次失败原因。 */
  error: string;
  /** 最近更新时间。 */
  updated_at: number;
}
