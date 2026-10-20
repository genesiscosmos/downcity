/**
 * Agent Gateway 的 City Token 授权适配器。
 * 凭据属于 City；本实例仅固定 Gateway 的目标 Agent，不拥有 Token 或数据库连接。
 */
import type { CityTokenRepository } from "@downcity/city/local";
import { AuthError } from "./AuthError.js";
import type { CityTokenPrincipal } from "@/city/types/auth/CityTokenPrincipal.js";

/** Gateway 所需的授权依赖。 */
export interface AuthServiceOptions {
  /** 当前路由实际指向的 Agent ID。 */
  agent_id: string;
  /** 由 City 本地组合根持有的凭据仓储。 */
  repository: CityTokenRepository;
}

/** 向已有 Gateway 中间件投影 City 授权结果。 */
export class AuthService {
  constructor(private readonly options: AuthServiceOptions) {}
  /** 宿主关闭协议；仓储连接由组合根释放。 */
  close(): void {}
  /** 每次请求重新检查授权，禁止 Token 访问范围外的 Agent。 */
  authenticate_bearer_header(header: string | undefined): CityTokenPrincipal {
    try {
      const token = this.options.repository.authorize(header, this.options.agent_id);
      return { agent_id: this.options.agent_id, token_id: token.token_id, token_name: token.name };
    } catch { throw new AuthError("Invalid City Token or Agent access denied", 401); }
  }
}
