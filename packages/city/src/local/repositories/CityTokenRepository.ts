/**
 * City Token 唯一持久化与授权规则，CLI/Desktop 可共用。
 * 摘要查询不含哈希，明文只在签发时返回；请求执行时重新读取有效授权范围。
 */
import { randomBytes, randomUUID, createHash } from "node:crypto";
import type { LocalDatabase } from "../database/LocalDatabase.js";
import type { CityTokenConfig, CityTokenRow, CityTokenSummary, IssuedCityToken } from "../types/CityToken.js";

/** 在外部连接拥有的 SQLite 上管理 City 凭据。 */
export class CityTokenRepository {
  constructor(private readonly database: LocalDatabase) {}

  /** 只返回可展示摘要。 */
  list(): CityTokenSummary[] {
    return (this.database.prepare("SELECT * FROM city_tokens ORDER BY created_at DESC").all() as unknown as CityTokenRow[]).map(decode_summary);
  }

  /** 获取可展示配置，用于交互式编辑。 */
  get(token_id: string): CityTokenSummary {
    const row = this.database.prepare("SELECT * FROM city_tokens WHERE token_id = ?").get(token_id) as unknown as CityTokenRow | undefined;
    if (!row) throw new Error("City Token not found");
    return decode_summary(row);
  }

  /** 签发后只返回一次随机明文，其他 API 无法恢复。 */
  create(input: CityTokenConfig): IssuedCityToken {
    const config = normalize_config(input);
    const token = `dc_city_${randomBytes(32).toString("base64url")}`;
    const now = new Date().toISOString();
    const token_id = randomUUID();
    this.database.prepare(`INSERT INTO city_tokens
      (token_id, name, all_agents, agent_ids_json, token_hash, expires_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(token_id, config.name, Number(config.all_agents), JSON.stringify(config.agent_ids), hash_token(token), config.expires_at, now, now);
    return { ...this.get(token_id), token };
  }

  /** 修改授权不会轮换明文；执行中的请求通过重新授权感知变更。 */
  update(token_id: string, input: CityTokenConfig): CityTokenSummary {
    this.get(token_id);
    const config = normalize_config(input);
    this.database.prepare("UPDATE city_tokens SET name = ?, all_agents = ?, agent_ids_json = ?, expires_at = ?, updated_at = ? WHERE token_id = ?")
      .run(config.name, Number(config.all_agents), JSON.stringify(config.agent_ids), config.expires_at, new Date().toISOString(), token_id);
    return this.get(token_id);
  }

  /** 撤销后不能再通过身份校验。 */
  remove(token_id: string): void {
    if (!this.database.prepare("DELETE FROM city_tokens WHERE token_id = ?").run(token_id).changes) throw new Error("City Token not found");
  }

  /** 认证 City 凭据，结果只有范围和摘要，不返回哈希或明文。 */
  authenticate(header: string | undefined): CityTokenSummary {
    const match = /^Bearer\s+(\S+)$/i.exec(header ?? "");
    if (!match) throw new Error("Missing City bearer token");
    const row = this.database.prepare("SELECT * FROM city_tokens WHERE token_hash = ?").get(hash_token(match[1]!)) as unknown as CityTokenRow | undefined;
    if (!row || (row.expires_at && Date.parse(row.expires_at) <= Date.now())) throw new Error("Invalid or expired City Token");
    this.database.prepare("UPDATE city_tokens SET last_used_at = ? WHERE token_id = ?").run(new Date().toISOString(), row.token_id);
    return decode_summary(row);
  }

  /** 包括长连接在内，每次调用检查当前存储中的 Agent 范围及到期时间。 */
  authorize(header: string | undefined, agent_id: string): CityTokenSummary {
    const summary = this.authenticate(header);
    if (!summary.all_agents && !summary.agent_ids.includes(agent_id)) throw new Error("City Token does not allow this Agent");
    return summary;
  }
}

/** 不接受隐式全部授权或空指定范围。 */
function normalize_config(input: CityTokenConfig): CityTokenConfig {
  const name = input.name.trim();
  if (!name) throw new Error("Token name is required");
  const agent_ids = [...new Set(input.agent_ids.map((id) => id.trim()).filter(Boolean))].sort();
  if (typeof input.all_agents !== "boolean" || (input.all_agents ? agent_ids.length > 0 : agent_ids.length === 0)) throw new Error("Choose either all Agents or a nonempty Agent list");
  let expires_at: string | null = null;
  if (input.expires_at !== null) {
    const date = new Date(input.expires_at);
    if (!Number.isFinite(date.getTime()) || date.getTime() <= Date.now()) throw new Error("Expiry must be a future ISO8601 date");
    expires_at = date.toISOString();
  }
  return { name, all_agents: input.all_agents, agent_ids, expires_at };
}

function hash_token(token: string): string { return createHash("sha256").update(token).digest("hex"); }

/** 内部存储投影到公开摘要。 */
function decode_summary(row: CityTokenRow): CityTokenSummary {
  return { token_id: row.token_id, name: row.name, all_agents: row.all_agents === 1, agent_ids: JSON.parse(row.agent_ids_json), expires_at: row.expires_at, last_used_at: row.last_used_at, created_at: row.created_at, updated_at: row.updated_at };
}
