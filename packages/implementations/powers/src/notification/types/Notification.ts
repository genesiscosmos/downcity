/** Notification Power的持久更新协议；Interaction仅引用原Session，不复制处理状态。 */
import type { PowerJsonObject } from "@downcity/city/power";

/** 一条无需阻塞原执行的用户更新。 */
export interface NotificationItem {
  /** 基于来源命名空间和事件键的稳定通知标识。 */
  notification_id: string;
  /** 发布该更新的Power，运行时完成事件使用notification。 */
  power_id: string;
  /** 来源主体；City级业务通知可以省略。 */
  agent_id?: string;
  /** 来源内的稳定事件键。 */
  topic_key: string;
  /** 简短用户可见标题。 */
  title: string;
  /** 可选的安全摘要，不包含私密输入。 */
  body?: string;
  /** 打开原结果的结构化路由。 */
  route?: PowerJsonObject;
  /** 本条更新创建时间，单位毫秒。 */
  created_at: number;
  /** 用户是否已明确查看或标记已读。 */
  read: boolean;
}
