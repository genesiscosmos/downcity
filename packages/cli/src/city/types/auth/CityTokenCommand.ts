/** City Token 命令参数；不包含从外部读取的明文凭据。 */
export interface CityTokenCommandOptions {
  /** 用户可读名称。 */ name?: string;
  /** 逗号分隔的稳定 Agent IDs。 */ agents?: string;
  /** 明确允许全部现有及未来 Agents。 */ allAgents?: boolean;
  /** ISO8601 到期时刻。 */ expiresAt?: string;
  /** 明确永不过期。 */ neverExpires?: boolean;
  /** 以 JSON 输出结果供脚本使用。 */ json?: boolean;
}
