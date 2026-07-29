/** Organizations Service 的 Membership 类型。 */

/** Organization 治理角色。 */
export type OrganizationRole = "owner" | "admin" | "member";

/** Membership 生命周期状态。 */
export type OrganizationMembershipState = "active" | "removed";

/** User 与 Organization 之间的一段独立成员关系。 */
export interface OrganizationMembershipRecord extends Record<string, unknown> {
  /** 每次成功加入时生成的唯一 Membership ID。 */
  membership_id: string;
  /** Membership 所属 Organization。 */
  organization_id: string;
  /** Membership 所属 Federation User。 */
  user_id: string;
  /** 当前 Organization 治理角色。 */
  role: OrganizationRole;
  /** 当前 Membership 生命周期状态。 */
  state: OrganizationMembershipState;
  /** ISO 8601 创建时间。 */
  created_at: string;
  /** ISO 8601 最后更新时间。 */
  updated_at: string;
  /** ISO 8601 移除时间；active 时为空字符串。 */
  removed_at: string;
  /** 执行移除的用户 ID；主动退出时等于自身，active 时为空字符串。 */
  removed_by: string;
}

/** 用户当前拥有 active Organization 的额度槽位。 */
export interface OrganizationOwnerSlotRecord extends Record<string, unknown> {
  /** Organization 所属 City。 */
  city_id: string;
  /** 当前 Owner 用户 ID。 */
  user_id: string;
  /** 从 1 开始的稳定额度槽位编号。 */
  slot: number;
  /** 占用该槽位的 Organization ID。 */
  organization_id: string;
  /** ISO 8601 槽位占用时间。 */
  created_at: string;
}
