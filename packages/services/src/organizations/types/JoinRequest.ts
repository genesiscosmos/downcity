/** Organizations Service 的 Join Request 类型。 */

/** Join Request 生命周期状态。 */
export type OrganizationJoinRequestState = "pending" | "approved" | "rejected" | "canceled";

/** 用户主动申请加入 Organization 的记录。 */
export interface OrganizationJoinRequestRecord extends Record<string, unknown> {
  /** Join Request 稳定主键。 */
  request_id: string;
  /** 目标 Organization。 */
  organization_id: string;
  /** 申请用户 ID。 */
  user_id: string;
  /** Join Request 当前状态。 */
  state: OrganizationJoinRequestState;
  /** ISO 8601 申请时间。 */
  requested_at: string;
  /** ISO 8601 决策或取消时间；pending 时为空字符串。 */
  decided_at: string;
  /** 决策用户 ID；用户取消时为自身，pending 时为空字符串。 */
  decided_by: string;
}
