/** Organizations Service 的撤权事件类型。 */

/** 会改变 City Server 授权结果的 Organization 事件。 */
export type OrganizationEventType =
  | "organization.membership.removed"
  | "organization.archived"
  | "organization.server_url.changed";

/** 撤权事件 Outbox 记录。 */
export interface OrganizationEventRecord extends Record<string, unknown> {
  /** 事件稳定主键和幂等键。 */
  event_id: string;
  /** 事件业务类型。 */
  event_type: OrganizationEventType;
  /** 事件所属 City。 */
  city_id: string;
  /** 事件所属 Organization。 */
  organization_id: string;
  /** Membership 撤权目标；Organization 级事件为空字符串。 */
  membership_id: string;
  /** Member 撤权目标；Organization 级事件为空字符串。 */
  user_id: string;
  /** 本次事件应投递到的 City Server Origin。 */
  target_url: string;
  /** 稳定 JSON Payload。 */
  payload_json: string;
  /** Outbox 投递状态。 */
  delivery_state: "pending" | "delivered";
  /** 已经执行的投递次数。 */
  delivery_attempts: number;
  /** 最近一次投递错误；成功或未投递时为空字符串。 */
  last_error: string;
  /** ISO 8601 创建时间。 */
  created_at: string;
  /** ISO 8601 成功投递时间；pending 时为空字符串。 */
  delivered_at: string;
}

/** Federation 发给 City Server 的公开撤权事件。 */
export interface OrganizationRevocationEvent {
  /** 事件稳定主键和幂等键。 */
  event_id: string;
  /** 事件业务类型。 */
  event_type: OrganizationEventType;
  /** 事件所属 City。 */
  city_id: string;
  /** 事件所属 Organization。 */
  organization_id: string;
  /** Membership 撤权目标；Organization 级事件为空字符串。 */
  membership_id: string;
  /** Member 撤权目标；Organization 级事件为空字符串。 */
  user_id: string;
  /** ISO 8601 事件创建时间。 */
  created_at: string;
}
