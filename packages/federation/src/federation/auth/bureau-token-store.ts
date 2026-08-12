/**
 * Federation Bureau Token Store。
 *
 * Token 使用 `fb_<token_id>.<secret>` 格式。数据库只保存完整 token 的 SHA-256 hash，
 * 通过 token_id 定位记录后再比较 hash，从而支持注册表状态校验和撤销。
 */

import { base64UrlEncodeBytes } from "../../utils/helpers.js";
import { require_bureau_id } from "../identity/bureau-id.js";
import type { CityTableApi } from "../../store/table-api.js";
import type {
  BureauTokenIssueResult,
  BureauTokenRecord,
  BureauTokenSummary,
  IssueBureauTokenInput,
} from "../../types/Bureau.js";

/** Bureau Token 持久化与验证入口。 */
export class BureauTokenStore {
  constructor(private readonly table: CityTableApi<BureauTokenRecord>) {}

  /** 在 Federation 内签发 Bureau Token；数据库只持久化 hash。 */
  async issue(input: IssueBureauTokenInput): Promise<BureauTokenIssueResult> {
    const bureau_id = require_bureau_id(input.bureau_id);
    const purpose = read_token_purpose(input.purpose);
    const token_id = await this.create_unique_token_id();
    const bureau_token = `fb_${token_id}.${random_base64_url(32)}`;
    const token_hash = await hash_token(bureau_token);
    const now = new Date().toISOString();
    await this.table.insert({
      token_id,
      bureau_id,
      purpose,
      token_hash,
      status: "active",
      created_at: now,
      updated_at: now,
    });
    return {
      token_id,
      bureau_id,
      purpose,
      status: "active",
      created_at: now,
      updated_at: now,
      bureau_token,
    };
  }

  /** 验证 Bureau Token 是否属于当前 Federation 的 active 管理凭证。 */
  async resolve(bureau_token: string): Promise<BureauTokenSummary | undefined> {
    const token_id = read_token_id(bureau_token);
    if (!token_id) return undefined;
    const record = (await this.table.select({ token_id }))[0];
    if (!record || record.status !== "active") return undefined;
    if (record.token_hash !== await hash_token(bureau_token)) return undefined;
    return summarize(record);
  }

  /** 列出 Bureau Token 元数据，不返回 token hash。 */
  async list(bureau_id?: string): Promise<BureauTokenSummary[]> {
    const rows = bureau_id === undefined
      ? await this.table.select()
      : await this.table.select({ bureau_id: require_bureau_id(bureau_id) });
    return rows.map(summarize);
  }

  /** 立即撤销 Bureau Token。 */
  async revoke(token_id: string): Promise<void> {
    const id = read_required_string(token_id, "token_id");
    if (!(await this.table.select({ token_id: id }))[0]) {
      throw new TypeError(`Unknown Bureau token: ${id}`);
    }
    await this.table.update({
      where: { token_id: id },
      values: { status: "revoked", updated_at: new Date().toISOString() },
    });
  }

  /** 撤销一个 Bureau 的全部 active 机器凭证。 */
  async revoke_for_bureau(bureau_id: string): Promise<void> {
    const id = require_bureau_id(bureau_id);
    const now = new Date().toISOString();
    for (const record of await this.table.select({ bureau_id: id })) {
      if (record.status !== "active") continue;
      await this.table.update({
        where: { token_id: record.token_id },
        values: { status: "revoked", updated_at: now },
      });
    }
  }

  /** 极低概率碰撞时重新生成查找 ID，避免覆盖既有凭证。 */
  private async create_unique_token_id(): Promise<string> {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const token_id = `br_${random_base64_url(12)}`;
      if (!(await this.table.select({ token_id }))[0]) return token_id;
    }
    throw new Error("Unable to allocate a unique Bureau token ID");
  }
}

function summarize(record: BureauTokenRecord): BureauTokenSummary {
  return {
    token_id: record.token_id,
    bureau_id: record.bureau_id,
    purpose: record.purpose,
    status: record.status,
    created_at: record.created_at,
    updated_at: record.updated_at,
  };
}

function read_token_purpose(value: unknown): string {
  const purpose = read_required_string(value, "purpose");
  if (purpose.length > 200) {
    throw new TypeError("purpose must be at most 200 characters");
  }
  return purpose;
}

function read_token_id(token: string): string | undefined {
  const match = String(token ?? "").trim().match(/^fb_(br_[A-Za-z0-9_-]+)\.[A-Za-z0-9_-]+$/u);
  return match?.[1];
}

async function hash_token(token: string): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return base64UrlEncodeBytes(new Uint8Array(hash));
}

/** 使用 Web Crypto 生成跨 Node.js、Worker 运行时一致的 Base64URL 随机值。 */
function random_base64_url(byte_length: number): string {
  const bytes = new Uint8Array(byte_length);
  crypto.getRandomValues(bytes);
  return base64UrlEncodeBytes(bytes);
}

function read_required_string(value: unknown, name: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new TypeError(`${name} must be a non-empty string`);
  }
  return value.trim();
}
