/** Notification Power的持久更新协议；Interaction仅引用原Session，不复制处理状态。 */
import type { PowerNotificationTarget, PowerNotificationScope, PowerNotificationOutcome, PowerNotificationAvailability } from "@downcity/city/power";

/** 一条无需阻塞原执行的用户更新。 */
export interface NotificationItem {
  /** 基于来源命名空间和事件键的稳定通知标识。 */
  notification_id: string;
  /** 发布该更新的Power，运行时完成事件使用notification。 */
  power_id: string;
  /** 来源主体；City级业务通知可以省略。 */
  agent_id?: string;
  /** 原始事实来源，独立于导航目标和更新含义。 */
  source_kind: "session" | "group" | "power";
  /** 展示范围；session 仅用于会话未读，不出现在 Inbox 或角标。 */
  scope: PowerNotificationScope;
  /** 最近一次业务结果，界面无需解析标题。 */
  outcome: PowerNotificationOutcome;
  /** 生命周期入口核对的来源状态；记录本身始终保留。 */
  availability: PowerNotificationAvailability;
  /** 来源内的稳定关注事项键；执行历史由来源保留。 */
  topic_key: string;
  /** 简短用户可见标题。 */
  title: string;
  /** 可选的安全摘要，不包含私密输入。 */
  body?: string;
  /** 原事件的幂等身份；不参与关注事项身份和角标数量。 */
  event_id?: string;
  /** 稳定的业务目标，不包含 Workspace 绑定。 */
  target: PowerNotificationTarget;
  /** 普通更新的注意力类别，待处理请求不写入普通更新。 */
  kind: "reply" | "update";
  /** 本条更新创建时间，单位毫秒。 */
  created_at: number;
  /** 用户是否已明确查看或标记已读。 */
  read: boolean;
}
