/**
 * 独立调用凭据管理与授权。
 * 明文由 256 位随机材料生成，仅签发时返回；SHA-256 摘要用于数据库查询。
 * 验证每次读取持久化状态，因此撤销、停用和到期立即阻断新请求。消费检查
 * 只读取可靠结算 completed 的实际 charge，不创建钱包或预占额度。
 */
import { z } from "zod";
import type { CityTableApi } from "../../store/table-api.js";
import type { ServiceDatabaseContext } from "../../types/database/Database.js";
import type { RelayKeyInfo, RelayKeyIssued, RelayKeyRecord, RelayKeyList, RelayPrincipal } from "../../types/Relay.js";
import { httpError } from "../../utils/helpers.js";

const policy_schema = z.object({
  name: z.string().trim().min(1).max(100),
  allowed_models: z.array(z.string().trim().min(1).max(160)).max(1000),
  spend_limit: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).nullable(),
  expires_at: z.string().datetime({ offset: true }).nullable(),
}).strict();

/** 计算高熵调用凭据的不可逆摘要。 */
async function digest_key(token: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** 过滤凭据摘要，禁止管理 API 意外返回内部字段。 */
function public_key(record: RelayKeyRecord): RelayKeyInfo {
  const { digest: _digest, ...info } = record;
  return info;
}

/** API Key 管理和消费准入；不参与 Federation 通用身份解析。 */
export class RelayKeyStore {
  constructor(
    private readonly table: CityTableApi<RelayKeyRecord>,
    private readonly database: ServiceDatabaseContext,
  ) {}

  async create(user_id: string, input: Record<string, unknown>): Promise<RelayKeyIssued> {
    const parsed = policy_schema.safeParse({ spend_limit: null, expires_at: null, allowed_models: [], ...input });
    if (!parsed.success) throw httpError(422, "Invalid API Key policy");
    if (parsed.data.expires_at && Date.parse(parsed.data.expires_at) <= Date.now()) throw httpError(422, "expires_at must be in the future");
    const random = crypto.getRandomValues(new Uint8Array(32));
    const token = "dck_" + Array.from(random, (byte) => byte.toString(16).padStart(2, "0")).join("");
    const record: RelayKeyRecord = {
      ...parsed.data,
      key_id: `key_${crypto.randomUUID()}`, user_id, digest: await digest_key(token),
      prefix: token.slice(0, 12), status: "active", created_at: new Date().toISOString(),
    };
    await this.table.insert(record);
    return { key: public_key(record), api_key: token };
  }

  async list(user_id: string): Promise<RelayKeyList> {
    return { items: (await this.table.select({ user_id })).map(public_key) };
  }

  /** 更新名称、权限和软上限；撤销状态不可恢复。 */
  async update(user_id: string, input: Record<string, unknown>): Promise<RelayKeyInfo> {
    const key_id = typeof input.key_id === "string" ? input.key_id : "";
    const record = (await this.table.select({ key_id, user_id }))[0];
    if (!record) throw httpError(404, "API Key not found");
    if (record.status === "revoked") throw httpError(409, "API Key is revoked");
    const { key_id: _key_id, status, ...policy_input } = input;
    const parsed = policy_schema.safeParse({
      name: record.name, allowed_models: record.allowed_models,
      spend_limit: record.spend_limit, expires_at: record.expires_at, ...policy_input,
    });
    if (!parsed.success || (status !== undefined && !["active", "disabled", "revoked"].includes(String(status)))) {
      throw httpError(422, "Invalid API Key policy");
    }
    const values = { ...parsed.data, status: (status ?? record.status) as RelayKeyRecord["status"] };
    const changed = await this.table.update({ where: { key_id, user_id, status: record.status }, values });
    if (!changed) throw httpError(409, "API Key changed; reload before saving");
    return public_key({ ...record, ...values });
  }

  /** 只返回最小调用主体；不创建 user 登录凭证或通用 user 身份。 */
  async authorize(token: string, requested_model?: string): Promise<RelayPrincipal> {
    if (!/^dck_[a-f0-9]{64}$/.test(token)) throw httpError(401, "Invalid API Key");
    const row = (await this.table.select({ digest: await digest_key(token) }))[0];
    if (!row || row.status !== "active" || (row.expires_at && Date.parse(row.expires_at) <= Date.now())) {
      throw httpError(401, "API Key is inactive or expired");
    }
    if (requested_model && !row.allowed_models.includes("*") && !row.allowed_models.includes(requested_model)) {
      throw httpError(403, "API Key cannot access this model or route");
    }
    return { key_id: row.key_id, user_id: row.user_id, allowed_models: row.allowed_models, spend_limit: row.spend_limit };
  }

  /** 与账户余额检查并行执行，仅读取已完成的可靠结算。 */
  async check_spend(principal: RelayPrincipal): Promise<void> {
    if (principal.spend_limit !== null) {
      const result = await this.database.query<{ spent: number }>({
        sql: `SELECT COALESCE(SUM(COALESCE(json_extract(s.payload_json, '$.charge.credits'), 0)), 0) AS spent
          FROM service_ai_relay_requests r JOIN service_ai_settlement_jobs s ON s.usage_id = r.request_id
          WHERE r.key_id = ? AND s.status = 'completed'`,
        params: [principal.key_id],
      });
      if (Number(result.rows[0]?.spent ?? 0) >= principal.spend_limit) throw httpError(402, "API Key settled spending limit reached");
    }
  }
}
