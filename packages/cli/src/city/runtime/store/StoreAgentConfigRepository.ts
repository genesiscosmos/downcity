/**
 * Agent 全局配置行存储仓储。
 *
 * 关键点（中文）
 * - 每个项目根目录独占一行，避免多个 Agent 更新同一个 JSON 聚合值。
 * - 配置正文继续使用平台 AES-256-GCM 密钥加密。
 * - 调用方负责在需要原子读改写时包裹 SQLite 事务。
 */
import type { PlatformStoreContext } from "@/city/runtime/store/StoreShared.js";
import { decryptTextSync, encryptTextSync } from "@/city/runtime/store/crypto.js";
import {
  getSecureSettingJsonSync,
  removeSecureSetting,
} from "@/city/runtime/store/StoreSecureSettings.js";
import type {
  LegacyAgentConfigsState,
  StoredAgentConfig,
} from "@/city/types/AgentConfig.js";

function decode_config(value_encrypted: unknown): StoredAgentConfig | null {
  if (typeof value_encrypted !== "string" || !value_encrypted) return null;
  return JSON.parse(decryptTextSync(value_encrypted)) as StoredAgentConfig;
}

function resolve_updated_at_ms(config: StoredAgentConfig): number {
  const timestamp = Date.parse(String(config.updated_at || ""));
  return Number.isFinite(timestamp) ? timestamp : 0;
}

/** 读取指定项目的加密 Agent 配置。 */
export function get_agent_config_row(
  context: PlatformStoreContext,
  project_root: string,
): StoredAgentConfig | null {
  const row = context.sqlite.prepare(`
    SELECT config_encrypted
    FROM agent_configs
    WHERE project_root = ?
    LIMIT 1;
  `).get(project_root) as { config_encrypted?: unknown } | undefined;
  return decode_config(row?.config_encrypted);
}

/** 列出全部加密 Agent 配置。 */
export function list_agent_config_rows(
  context: PlatformStoreContext,
): StoredAgentConfig[] {
  const rows = context.sqlite.prepare(`
    SELECT config_encrypted
    FROM agent_configs
    ORDER BY project_root ASC;
  `).all() as Array<{ config_encrypted?: unknown }>;
  return rows
    .map((row) => decode_config(row.config_encrypted))
    .filter((config): config is StoredAgentConfig => config !== null);
}

/** 原子写入单个项目的完整 Agent 配置。 */
export function set_agent_config_row(
  context: PlatformStoreContext,
  config: StoredAgentConfig,
): void {
  const encrypted = encryptTextSync(JSON.stringify(config));
  context.sqlite.prepare(`
    INSERT INTO agent_configs (
      project_root,
      config_encrypted,
      created_at,
      updated_at
    ) VALUES (?, ?, ?, ?)
    ON CONFLICT(project_root) DO UPDATE SET
      config_encrypted = excluded.config_encrypted,
      updated_at = excluded.updated_at;
  `).run(
    config.project_root,
    encrypted,
    config.created_at,
    config.updated_at,
  );
}

/** 删除指定项目的 Agent 配置行。 */
export function remove_agent_config_row(
  context: PlatformStoreContext,
  project_root: string,
): void {
  context.sqlite.prepare(
    "DELETE FROM agent_configs WHERE project_root = ?;",
  ).run(project_root);
}

/**
 * 将旧的 DB 内聚合配置迁移为独立行。
 *
 * 关键点（中文）
 * - 这是数据库内部 schema 迁移，不读取项目文件或旧 JSON 配置。
 * - 仅当旧聚合值更新时间更晚时覆盖现有行，兼容升级期间尚未重启的旧 daemon。
 * - 全部写入成功后删除旧 secure setting，后续不再双读。
 */
export function migrate_agent_config_rows(
  context: PlatformStoreContext,
  legacy_setting_key: string,
): void {
  const legacy_state = getSecureSettingJsonSync<LegacyAgentConfigsState>(
    context,
    legacy_setting_key,
  );
  if (!legacy_state) return;

  const migrate = context.sqlite.transaction(() => {
    for (const config of Array.isArray(legacy_state.configs)
      ? legacy_state.configs
      : []) {
      if (!config?.project_root) continue;
      const existing = get_agent_config_row(context, config.project_root);
      if (
        existing &&
        resolve_updated_at_ms(existing) >= resolve_updated_at_ms(config)
      ) {
        continue;
      }
      set_agent_config_row(context, config);
    }
    removeSecureSetting(context, legacy_setting_key);
  });
  migrate.immediate();
}
