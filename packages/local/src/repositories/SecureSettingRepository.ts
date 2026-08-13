/** 本地加密设置仓储。 */

import type { LocalCrypto } from "@/database/LocalCrypto.js";
import type { LocalDatabase } from "@/database/LocalDatabase.js";

/** 管理平台级加密键值配置。 */
export class SecureSettingRepository {
  constructor(
    private readonly database: LocalDatabase,
    private readonly crypto_adapter: LocalCrypto,
  ) {}

  /** 读取一个已解密的结构化设置。 */
  get<T>(key_input: string): T | null {
    const key = require_key(key_input);
    const row = this.database.prepare(`
      SELECT value_encrypted FROM platform_secure_settings WHERE key = ? LIMIT 1;
    `).get(key) as { value_encrypted?: string } | undefined;
    if (!row?.value_encrypted) return null;
    return JSON.parse(this.crypto_adapter.decrypt(row.value_encrypted)) as T;
  }

  /** 写入一个加密的结构化设置。 */
  set(key_input: string, value: unknown): void {
    const key = require_key(key_input);
    const current_time = new Date().toISOString();
    this.database.prepare(`
      INSERT INTO platform_secure_settings (key, value_encrypted, created_at, updated_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET
        value_encrypted = excluded.value_encrypted,
        updated_at = excluded.updated_at;
    `).run(
      key,
      this.crypto_adapter.encrypt(JSON.stringify(value ?? null)),
      current_time,
      current_time,
    );
  }

  /** 删除一个设置。 */
  remove(key_input: string): void {
    this.database.prepare(
      "DELETE FROM platform_secure_settings WHERE key = ?;",
    ).run(require_key(key_input));
  }
}

/** 校验设置键。 */
function require_key(value: string): string {
  const key = String(value || "").trim();
  if (!key) throw new Error("secure setting key is required");
  return key;
}
