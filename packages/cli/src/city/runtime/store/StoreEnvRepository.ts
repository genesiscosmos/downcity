/**
 * PlatformStore 环境变量仓储。
 *
 * 关键点（中文）
 * - 统一管理 `env_entries` 单表。
 * - 当前版本只保留平台全局 env，不再区分 agent 私有层。
 */

import type {
  StoredEnvEntry,
  StoredGlobalEnvEntry,
  UpsertEnvEntryInput,
  UpsertGlobalEnvEntryInput,
} from "@/city/types/platform/PlatformStore.js";
import { decryptText, decryptTextSync, encryptText } from "@/city/runtime/store/crypto.js";
import type { PlatformStoreContext } from "@/city/runtime/store/StoreShared.js";
import { normalizeNonEmptyText, nowIso } from "@/city/runtime/store/StoreShared.js";

/**
 * 同步构造 env 条目。
 */
function buildEnvEntryFromRowSync(row: {
  scope?: unknown;
  agent_id?: unknown;
  key?: unknown;
  description?: unknown;
  value_encrypted?: unknown;
  created_at?: unknown;
  updated_at?: unknown;
}): StoredEnvEntry | null {
  const key = String(row.key || "").trim();
  const encrypted = typeof row.value_encrypted === "string" ? row.value_encrypted : "";
  if (String(row.scope || "").trim() !== "global") return null;
  if (!key || !encrypted) return null;
  return {
    scope: "global",
    key,
    description: String(row.description || "").trim() || undefined,
    value: decryptTextSync(encrypted),
    created_at: String(row.created_at || ""),
    updated_at: String(row.updated_at || ""),
  };
}

/**
 * 异步构造 env 条目。
 */
async function buildEnvEntryFromRow(row: {
  scope?: unknown;
  agent_id?: unknown;
  key?: unknown;
  description?: unknown;
  value_encrypted?: unknown;
  created_at?: unknown;
  updated_at?: unknown;
}): Promise<StoredEnvEntry | null> {
  const key = String(row.key || "").trim();
  const encrypted = typeof row.value_encrypted === "string" ? row.value_encrypted : "";
  if (String(row.scope || "").trim() !== "global") return null;
  if (!key || !encrypted) return null;
  return {
    scope: "global",
    key,
    description: String(row.description || "").trim() || undefined,
    value: await decryptText(encrypted),
    created_at: String(row.created_at || ""),
    updated_at: String(row.updated_at || ""),
  };
}

/**
 * 同步列出 env 条目。
 */
export function listEnvEntriesSync(
  context: PlatformStoreContext,
): StoredEnvEntry[] {
  const rows = context.sqlite.prepare(
    `
    SELECT scope, agent_id, key, description, value_encrypted, created_at, updated_at
    FROM env_entries
    WHERE scope = 'global'
    ORDER BY key ASC;
    `,
  ).all();
  const out: StoredEnvEntry[] = [];
  for (const row of rows as Array<Record<string, unknown>>) {
    const entry = buildEnvEntryFromRowSync(row);
    if (entry) out.push(entry);
  }
  return out;
}

/**
 * 异步列出 env 条目。
 */
export async function listEnvEntries(
  context: PlatformStoreContext,
): Promise<StoredEnvEntry[]> {
  const rows = context.sqlite.prepare(
    `
    SELECT scope, agent_id, key, description, value_encrypted, created_at, updated_at
    FROM env_entries
    WHERE scope = 'global'
    ORDER BY key ASC;
    `,
  ).all();
  const out: StoredEnvEntry[] = [];
  for (const row of rows as Array<Record<string, unknown>>) {
    const entry = await buildEnvEntryFromRow(row);
    if (entry) out.push(entry);
  }
  return out;
}

/**
 * 新增或更新 env 条目。
 */
export async function upsertEnvEntry(
  context: PlatformStoreContext,
  input: UpsertEnvEntryInput,
): Promise<void> {
  const scope = "global";
  const agent_id = "";
  const key = normalizeNonEmptyText(input.key, "global env key");
  const description = String(input.description || "").trim();
  const value = String(input.value ?? "");
  const existing = context.sqlite
    .prepare(
      `
      SELECT created_at
      FROM env_entries
      WHERE scope = ? AND agent_id = ? AND key = ?
      LIMIT 1;
      `,
    )
    .get(scope, agent_id, key) as { created_at?: unknown } | undefined;
  const created_at = String(existing?.created_at || nowIso());
  const updated_at = nowIso();
  const encrypted = await encryptText(value);
  context.sqlite
    .prepare(
      `
      INSERT INTO env_entries (
        scope,
        agent_id,
        key,
        description,
        value_encrypted,
        created_at,
        updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(scope, agent_id, key) DO UPDATE SET
        description = excluded.description,
        value_encrypted = excluded.value_encrypted,
        updated_at = excluded.updated_at;
      `,
    )
    .run(scope, agent_id, key, description || null, encrypted, created_at, updated_at);
}

/**
 * 删除单个 env 条目。
 */
export function removeEnvEntry(
  context: PlatformStoreContext,
  keyInput: string,
): void {
  const key = normalizeNonEmptyText(keyInput, "global env key");
  context.sqlite
    .prepare("DELETE FROM env_entries WHERE scope = ? AND agent_id = ? AND key = ?;")
    .run("global", "", key);
}

/**
 * 同步列出全局环境变量。
 */
export function listGlobalEnvEntriesSync(
  context: PlatformStoreContext,
): StoredGlobalEnvEntry[] {
  return listEnvEntriesSync(context);
}

/**
 * 同步读取全局环境变量映射。
 */
export function getGlobalEnvMapSync(
  context: PlatformStoreContext,
): Record<string, string> {
  const entries = listGlobalEnvEntriesSync(context);
  const map: Record<string, string> = {};
  for (const item of entries) {
    map[item.key] = item.value;
  }
  return map;
}

/**
 * 异步列出全局环境变量。
 */
export async function listGlobalEnvEntries(
  context: PlatformStoreContext,
): Promise<StoredGlobalEnvEntry[]> {
  return listEnvEntries(context);
}

/**
 * 异步读取全局环境变量映射。
 */
export async function getGlobalEnvMap(
  context: PlatformStoreContext,
): Promise<Record<string, string>> {
  const entries = await listGlobalEnvEntries(context);
  const map: Record<string, string> = {};
  for (const item of entries) {
    map[item.key] = item.value;
  }
  return map;
}

/**
 * 新增或更新全局环境变量。
 */
export async function upsertGlobalEnvEntry(
  context: PlatformStoreContext,
  input: UpsertGlobalEnvEntryInput,
): Promise<void> {
  await upsertEnvEntry(context, {
    scope: "global",
    ...input,
  });
}

/**
 * 删除单个全局环境变量。
 */
export function removeGlobalEnvEntry(
  context: PlatformStoreContext,
  keyInput: string,
): void {
  removeEnvEntry(context, keyInput);
}

/**
 * 清空全局环境变量。
 */
export function clearGlobalEnvEntries(context: PlatformStoreContext): void {
  context.sqlite.prepare("DELETE FROM env_entries WHERE scope = 'global';").run();
}
