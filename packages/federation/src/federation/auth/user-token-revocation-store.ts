/**
 * 当前 User Token 会话撤销 registry。
 * 每次验证直接读持久化记录，不缓存有效状态；重复撤销通过唯一键幂等写入。
 * 初始化和撤销时删除过期记录，无需额外定时器或跨实例内存同步。
 */
import type { Database } from "../../database/Database.js";
import type { CityTableApi } from "../../store/table-api.js";
import type { UserTokenPayload } from "./types.js";
import type { UserTokenRevocationRecord } from "./user-token-schema.js";

/** 仅接收经过 UserTokenAuthority 验签的载荷。 */
export class UserTokenRevocationStore {
  constructor(
    private readonly table: CityTableApi<UserTokenRevocationRecord>,
    private readonly database: Database,
  ) {}

  /** 查找当前 jti 的撤销记录；数据库异常由上层拒绝请求。 */
  async is_revoked(token_id: string): Promise<boolean> {
    return (await this.table.select({ token_id })).length > 0;
  }

  /** 持久化撤销当前 jti；不撤销同一用户的其他登录会话。 */
  async revoke(payload: UserTokenPayload): Promise<void> {
    await this.table.insert_if_absent({ token_id: payload.jti, expires_at: payload.exp });
    await this.cleanup_expired();
  }

  /** 删除已无法通过 JWT 到期校验的记录；不读取或暴露 Token。 */
  async cleanup_expired(): Promise<void> {
    const placeholder = this.database.schema_id === "postgresql" ? "$1" : "?";
    await this.database.atomic([{
      sql: `DELETE FROM "federation_user_token_revocations" WHERE "expires_at" <= ${placeholder}`,
      params: [Math.floor(Date.now() / 1000)],
    }]);
  }
}
