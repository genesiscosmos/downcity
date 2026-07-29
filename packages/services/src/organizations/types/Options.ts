/** Organizations Service 初始化配置类型。 */

/** Organizations Service 初始化选项。 */
export interface OrganizationsServiceOptions {
  /** 每个用户最多同时拥有的 active Organization 数量。 */
  max_organizations_per_user: number;
  /** Organization Token TTL；默认 7d。 */
  organization_token_ttl?: string | number;
  /** 撤权事件 HTTP 投递实现；默认使用 globalThis.fetch。 */
  fetch?: typeof fetch;
}
