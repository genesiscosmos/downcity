/** Organizations Service 的 Organization 类型。 */

/** Organization 生命周期状态。 */
export type OrganizationState = "active" | "archived";

/** Organization 的可用作用域类型。 */
export type OrganizationScopeType = "federation" | "bureau";

/** Federation 中的 Organization 记录。 */
export interface OrganizationRecord extends Record<string, unknown> {
  /** Federation 生成的 Organization 稳定主键。 */
  organization_id: string;
  /** 面向用户展示的 Organization 名称。 */
  name: string;
  /** Organization 在整个 Federation 可用，或只在一个 Bureau 中可用。 */
  scope_type: OrganizationScopeType;
  /** Bureau 作用域对应的 Bureau ID；Federation 作用域时为空字符串。 */
  scope_bureau_id: string;
  /** Organization 当前生命周期状态。 */
  state: OrganizationState;
  /** 首次创建 Organization 的用户 ID。 */
  created_by: string;
  /** ISO 8601 创建时间。 */
  created_at: string;
  /** ISO 8601 最后更新时间。 */
  updated_at: string;
  /** ISO 8601 归档时间；未归档时为空字符串。 */
  archived_at: string;
}

/** 用户侧 Organization 列表项。 */
export interface UserOrganization extends OrganizationRecord {
  /** 当前用户在该 Organization 中的治理角色。 */
  role: "owner" | "admin" | "member";
  /** 当前用户对应的 Membership ID。 */
  membership_id: string;
  /** 当前 Membership 状态。 */
  membership_state: "active" | "removed";
}
