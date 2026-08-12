/**
 * Federation Ed25519 Key Ring 存储模块。
 *
 * 该模块负责生成、持久化和读取 Federation 用户 token 签名密钥。
 * 私钥只通过 get_active_signing_key() 返回给内部签发路径，JWKS 始终剥离私钥字段。
 */

import { exportJWK, generateKeyPair } from "jose";
import { randomSecret } from "../../utils/helpers.js";
import type { CityTableApi } from "../../store/table-api.js";
import type {
  FederationAuthKeyRecord,
  FederationJwks,
  FederationPublicJwk,
} from "./types.js";

/** 当前用户 token 使用的 JOSE 算法。 */
export const USER_TOKEN_ALGORITHM = "EdDSA" as const;

/** Federation Key Ring 数据访问入口。 */
export class FederationKeyStore {
  constructor(private readonly table: CityTableApi<FederationAuthKeyRecord>) {}

  /** 确保 Federation 至少存在一把 active signing key。 */
  async ensure_active_key(): Promise<FederationAuthKeyRecord> {
    const active_key = await this.get_active_key();
    return active_key ?? this.create_active_key();
  }

  /**
   * 将历史遗留的多把 active key 确定性收敛为一把。
   *
   * 保留创建时间最早的 key；时间相同时按 key_id 排序。其余 key 转为 retired，继续
   * 出现在 JWKS 中并可验证已签发 token，不会因自动修复导致存量会话失效。
   */
  async reconcile_active_keys(): Promise<FederationAuthKeyRecord | undefined> {
    const rows = await this.table.select({ status: "active" });
    if (rows.length <= 1) return rows[0];

    const [winner, ...duplicates] = [...rows].sort((left, right) =>
      left.created_at.localeCompare(right.created_at) || left.key_id.localeCompare(right.key_id)
    );
    const retired_at = new Date().toISOString();
    await Promise.all(duplicates.map((key) => this.table.update({
      where: { key_id: key.key_id, status: "active" },
      values: { status: "retired", retired_at },
    })));
    return winner;
  }

  /** 读取当前唯一 active signing key。 */
  async get_active_key(): Promise<FederationAuthKeyRecord | undefined> {
    const rows = await this.table.select({ status: "active" });
    if (rows.length > 1) {
      throw new Error("Federation must have exactly one active user token signing key");
    }
    return rows[0];
  }

  /** 按 kid 读取可用于验签的密钥。 */
  async get_verification_key(key_id: string): Promise<FederationAuthKeyRecord | undefined> {
    const rows = await this.table.select({ key_id });
    const key = rows[0];
    if (!key || key.status === "revoked") return undefined;
    return key;
  }

  /** 返回只包含公开字段的 JWKS。 */
  async get_public_jwks(): Promise<FederationJwks> {
    const rows = await this.table.select();
    const keys = rows
      .filter((row) => row.status !== "revoked")
      .map((row) => parse_public_jwk(row));
    return { keys };
  }

  /** 生成并保存新的 active Ed25519 signing key。 */
  private async create_active_key(): Promise<FederationAuthKeyRecord> {
    const key_id = `key_${randomSecret(16)}`;
    const key_pair = await generateKeyPair(USER_TOKEN_ALGORITHM, {
      crv: "Ed25519",
      extractable: true,
    });
    const public_jwk = await exportJWK(key_pair.publicKey);
    const private_jwk = await exportJWK(key_pair.privateKey);
    const record: FederationAuthKeyRecord = {
      key_id,
      algorithm: USER_TOKEN_ALGORITHM,
      public_jwk: JSON.stringify({
        ...public_jwk,
        alg: USER_TOKEN_ALGORITHM,
        use: "sig",
        kid: key_id,
      }),
      private_jwk: JSON.stringify({
        ...private_jwk,
        alg: USER_TOKEN_ALGORITHM,
        use: "sig",
        kid: key_id,
      }),
      status: "active",
      created_at: new Date().toISOString(),
      retired_at: "",
    };
    await this.table.insert_if_absent(record);
    const active_key = await this.get_active_key();
    if (!active_key) {
      throw new Error("Federation failed to initialize an active user token signing key");
    }
    return active_key;
  }
}

/** 将数据库 JSON 转成严格的公开 Ed25519 JWK。 */
function parse_public_jwk(record: FederationAuthKeyRecord): FederationPublicJwk {
  const value = JSON.parse(record.public_jwk) as Partial<FederationPublicJwk>;
  if (value.kty !== "OKP" || value.crv !== "Ed25519" || typeof value.x !== "string" || !value.x) {
    throw new Error(`Invalid Federation public JWK: ${record.key_id}`);
  }
  return {
    kty: "OKP",
    crv: "Ed25519",
    alg: USER_TOKEN_ALGORITHM,
    use: "sig",
    kid: record.key_id,
    x: value.x,
  };
}
