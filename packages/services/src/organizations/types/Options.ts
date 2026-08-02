/** Organizations Service 初始化配置类型。 */

/** Organizations Service 初始化选项。 */
export interface OrganizationsServiceOptions {
  /** 每个用户在 Federation 中最多同时拥有的 active Organization 总数。 */
  max_organizations_per_user: number;
}
