/** City 访问凭据：授权范围仅描述可访问的 Agents，不授予本机管理权限。 */
export interface CityTokenScope {
  /** 显式允许全部现有和未来的 Agent；与 agent_ids 非空互斥。 */
  all_agents: boolean;
  /** 明确允许的稳定 Agent ID；指定范围时至少一个。 */
  agent_ids: string[];
}

/** 可安全展示的凭据摘要，不包含明文和哈希。 */
export interface CityTokenSummary extends CityTokenScope {
  /** 记录标识，用于本机修改和撤销。 */
  token_id: string;
  /** 用户命名。 */
  name: string;
  /** 过期时刻，null 表示永不过期。 */
  expires_at: string | null;
  /** 最近通过身份认证的时刻，尚未使用为 null。 */
  last_used_at: string | null;
  /** 首次签发时刻。 */
  created_at: string;
  /** 最近配置修改时刻。 */
  updated_at: string;
}

/** 创建或修改时提交的完整配置。 */
export interface CityTokenConfig extends CityTokenScope {
  /** 非空名称。 */
  name: string;
  /** ISO8601 过期时刻；显式 null 表示永不过期。 */
  expires_at: string | null;
}

/** 只在创建时交给本机用户的明文凭据。 */
export interface IssuedCityToken extends CityTokenSummary {
  /** 一次性展示的 Bearer Token；数据库只保存其 SHA256 哈希。 */
  token: string;
}

/** 数据库内部行，不通过公开查询返回哈希。 */
export interface CityTokenRow {
  /** 记录主键。 */ token_id: string;
  /** 用户名称。 */ name: string;
  /** 是否允许所有 Agents，SQLite 布尔表示。 */ all_agents: number;
  /** 稳定 Agent ID 列表的 JSON。 */ agent_ids_json: string;
  /** 明文的 SHA256 哈希。 */ token_hash: string;
  /** 过期时刻。 */ expires_at: string | null;
  /** 最近使用时刻。 */ last_used_at: string | null;
  /** 创建时刻。 */ created_at: string;
  /** 修改时刻。 */ updated_at: string;
}
