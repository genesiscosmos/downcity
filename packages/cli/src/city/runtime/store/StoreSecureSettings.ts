/**
 * PlatformStore 加密配置仓储。
 *
 * 关键点（中文）
 * - 管理 `platform_secure_settings` 表。
 * - 平台级与 agent 级敏感配置都复用这套存储。
 */

import { decryptText, decryptTextSync, encryptText, encryptTextSync } from "@/city/runtime/store/crypto.js";
import type { PlatformStoreContext } from "@/city/runtime/store/StoreShared.js";
import { normalizeNonEmptyText, nowIso } from "@/city/runtime/store/StoreShared.js";

/**
 * 同步读取加密 JSON 配置。
 */
export function getSecureSettingJsonSync<T>(
  context: PlatformStoreContext,
  key: string,
): T | null {
  const settingKey = normalizeNonEmptyText(key, "setting key");
  const row = context.sqlite
    .prepare(
      "SELECT value_encrypted FROM platform_secure_settings WHERE key = ? LIMIT 1;",
    )
    .get(settingKey) as { value_encrypted?: unknown } | undefined;
  if (!row || typeof row.value_encrypted !== "string" || !row.value_encrypted) {
    return null;
  }
  const raw = decryptTextSync(row.value_encrypted);
  return JSON.parse(raw) as T;
}

/**
 * 同步写入加密 JSON 配置。
 */
export function setSecureSettingJsonSync(
  context: PlatformStoreContext,
  key: string,
  value: unknown,
): void {
  const settingKey = normalizeNonEmptyText(key, "setting key");
  const raw = JSON.stringify(value ?? null);
  const encrypted = encryptTextSync(raw);
  const now = nowIso();
  context.sqlite
    .prepare(
      `
      INSERT INTO platform_secure_settings (key, value_encrypted, created_at, updated_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET
        value_encrypted = excluded.value_encrypted,
        updated_at = excluded.updated_at;
      `,
    )
    .run(settingKey, encrypted, now, now);
}

/**
 * 删除加密配置。
 */
export function removeSecureSetting(
  context: PlatformStoreContext,
  key: string,
): void {
  const settingKey = normalizeNonEmptyText(key, "setting key");
  context.sqlite
    .prepare("DELETE FROM platform_secure_settings WHERE key = ?;")
    .run(settingKey);
}

/**
 * 异步读取加密 JSON 配置。
 */
export async function getSecureSettingJson<T>(
  context: PlatformStoreContext,
  key: string,
): Promise<T | null> {
  const settingKey = normalizeNonEmptyText(key, "setting key");
  const row = context.sqlite
    .prepare(
      "SELECT value_encrypted FROM platform_secure_settings WHERE key = ? LIMIT 1;",
    )
    .get(settingKey) as { value_encrypted?: unknown } | undefined;
  if (!row || typeof row.value_encrypted !== "string" || !row.value_encrypted) {
    return null;
  }
  const raw = await decryptText(row.value_encrypted);
  return JSON.parse(raw) as T;
}

/**
 * 异步写入加密 JSON 配置。
 */
export async function setSecureSettingJson(
  context: PlatformStoreContext,
  key: string,
  value: unknown,
): Promise<void> {
  const settingKey = normalizeNonEmptyText(key, "setting key");
  const raw = JSON.stringify(value ?? null);
  const encrypted = await encryptText(raw);
  const now = nowIso();
  context.sqlite
    .prepare(
      `
      INSERT INTO platform_secure_settings (key, value_encrypted, created_at, updated_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET
        value_encrypted = excluded.value_encrypted,
        updated_at = excluded.updated_at;
      `,
    )
    .run(settingKey, encrypted, now, now);
}

/**
 * 构造 agent 级加密配置 key。
 */
export function buildAgentSecureSettingKey(
  agentIdInput: string,
  keyInput: string,
): string {
  const agent_id = normalizeNonEmptyText(agentIdInput, "agent_id");
  const key = normalizeNonEmptyText(keyInput, "agent secure setting key");
  return `agent:${agent_id}:${key}`;
}
