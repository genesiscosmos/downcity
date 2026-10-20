/** 已通过 City Token 授权的当前 Gateway 请求身份，不代表凭据归属于该 Agent。 */
export interface CityTokenPrincipal {
  /** 当前请求实际访问且已获授权的 Agent。 */
  agent_id: string;
  /** City 凭据记录标识。 */
  token_id: string;
  /** City 凭据名称。 */
  token_name: string;
}
