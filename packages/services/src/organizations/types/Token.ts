/** Organizations Service 的 Token 类型。 */

/** Organization Token 中由 Organizations Service 拥有的 Claims。 */
export interface OrganizationTokenClaims {
  /** 当前 Federation 用户。 */
  user_id: string;
  /** Organization 所属 City。 */
  city_id: string;
  /** 当前访问的 Organization。 */
  organization_id: string;
  /** 签发依据的唯一 Membership。 */
  membership_id: string;
}

/** Organization Token 签发结果。 */
export interface OrganizationTokenIssueResult {
  /** 只允许目标 City Server 使用的长期 Token。 */
  organization_token: string;
  /** 当前 Organization。 */
  organization_id: string;
  /** Token audience 对应的 Server URL。 */
  server_url: string;
  /** ISO 8601 过期时间。 */
  expires_at: string;
}
