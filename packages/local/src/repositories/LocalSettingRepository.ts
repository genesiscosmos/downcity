/** 本地明文设置仓储。 */

import type { LocalDatabase } from "@/database/LocalDatabase.js";

/** 管理平台级 JSON 键值配置。 */
export class LocalSettingRepository {
  constructor(private readonly database: LocalDatabase) {}

  /** 读取一个结构化设置。 */
  get<T>(key_input: string): T | null {
    const key = require_key(key_input);
    const row = this.database.prepare(`
      SELECT value_json FROM platform_settings WHERE key = ? LIMIT 1;
    `).get(key) as { value_json?: string } | undefined;
    if (!row?.value_json) return null;
    return JSON.parse(row.value_json) as T;
  }

  /** 写入一个结构化设置。 */
  set(key_input: string, value: unknown): void {
    const key = require_key(key_input);
    const current_time = new Date().toISOString();
    this.database.prepare(`
      INSERT INTO platform_settings (key, value_json, created_at, updated_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET
        value_json = excluded.value_json,
        updated_at = excluded.updated_at;
    `).run(
      key,
      JSON.stringify(value ?? null),
      current_time,
      current_time,
    );
  }

  /** 删除一个设置。 */
  remove(key_input: string): void {
    this.database.prepare(
      "DELETE FROM platform_settings WHERE key = ?;",
    ).run(require_key(key_input));
  }
}

/** 校验设置键。 */
function require_key(value: string): string {
  const key = String(value || "").trim();
  if (!key) throw new Error("setting key is required");
  return key;
}
