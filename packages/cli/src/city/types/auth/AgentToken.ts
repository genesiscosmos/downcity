/**
 * 单 Agent Bearer Token 类型。
 *
 * 关键点（中文）：Token 只允许访问绑定 Agent，不承载用户、角色或细粒度权限。
 */

/** 数据库中的 Agent Token 摘要。 */
export interface AgentTokenSummary {
  /** Token 记录 ID。 */
  token_id: string;

  /** Token 所属 Agent 的稳定 ID。 */
  agent_id: string;

  /** 方便用户识别的 Token 名称。 */
  name: string;

  /** 可选过期时间，使用 ISO 8601 字符串。 */
  expires_at?: string;

  /** 最近使用时间，使用 ISO 8601 字符串。 */
  last_used_at?: string;

  /** 创建时间，使用 ISO 8601 字符串。 */
  created_at: string;

  /** 最近更新时间，使用 ISO 8601 字符串。 */
  updated_at: string;
}

/** 创建 Agent Token 后仅返回一次的明文结果。 */
export interface IssuedAgentToken extends AgentTokenSummary {
  /** 只在签发时返回一次的 Bearer Token 明文。 */
  token: string;
}

/** 已通过 Bearer 校验的单 Agent 调用主体。 */
export interface AgentTokenPrincipal {
  /** 当前请求允许访问的 Agent ID。 */
  agent_id: string;

  /** 当前 Bearer Token 记录 ID。 */
  token_id: string;

  /** 当前 Bearer Token 名称。 */
  token_name: string;
}
