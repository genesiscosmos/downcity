/**
 * Plugin 安装记录与 Agent Binding 行存储。
 *
 * 关键点（中文）
 * - Manifest 使用普通 JSON，便于安装目录检查与展示。
 * - Agent Plugin 配置使用平台密钥加密，避免普通配置中意外混入敏感字段后明文落盘。
 */

import type { PlatformStoreContext } from "@/city/runtime/store/StoreShared.js";
import { decryptTextSync, encryptTextSync } from "@/city/runtime/store/crypto.js";
import type {
  InstalledPluginInstallation,
  PluginInstallationManifest,
} from "@/city/types/plugin/PluginInstallation.js";
import type { AgentPluginBinding } from "@/city/types/plugin/AgentPluginBinding.js";

type InstalledPluginInstallationRow = {
  installation_id: string;
  source: string;
  resolved_commit: string | null;
  entry_path: string;
  manifest_json: string;
  integrity: string | null;
  installed_at: string;
  updated_at: string;
};

type AgentPluginRow = {
  agent_id: string;
  plugin_name: string;
  enabled: number;
  config_encrypted: string;
  resource_ids_json: string;
  created_at: string;
  updated_at: string;
};

/** 把已安装 Plugin 数据库行转换为领域记录。 */
function decode_plugin_installation(
  row: InstalledPluginInstallationRow,
): InstalledPluginInstallation {
  return {
    installation_id: row.installation_id,
    source: row.source,
    ...(row.resolved_commit ? { resolved_commit: row.resolved_commit } : {}),
    entry_path: row.entry_path,
    manifest: JSON.parse(row.manifest_json) as PluginInstallationManifest,
    integrity: row.integrity ?? "",
    installed_at: row.installed_at,
    updated_at: row.updated_at,
  };
}

/** 把 Agent Plugin 数据库行转换为领域记录。 */
function decode_agent_plugin(row: AgentPluginRow): AgentPluginBinding {
  return {
    agent_id: row.agent_id,
    plugin_name: row.plugin_name,
    enabled: row.enabled === 1,
    config: JSON.parse(decryptTextSync(row.config_encrypted)),
    resource_ids: parse_resource_ids(row.resource_ids_json),
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

/** 列出全部第三方 Plugin 内部安装记录。 */
export function list_plugin_installation_rows(
  context: PlatformStoreContext,
): InstalledPluginInstallation[] {
  const rows = context.sqlite.prepare(`
    SELECT * FROM plugin_installations ORDER BY installation_id ASC;
  `).all() as InstalledPluginInstallationRow[];
  return rows.map(decode_plugin_installation);
}

/** 按内部 ID 读取 Plugin 安装记录。 */
export function get_plugin_installation_row(
  context: PlatformStoreContext,
  installation_id: string,
): InstalledPluginInstallation | null {
  const row = context.sqlite.prepare(`
    SELECT * FROM plugin_installations WHERE installation_id = ? LIMIT 1;
  `).get(installation_id) as InstalledPluginInstallationRow | undefined;
  return row ? decode_plugin_installation(row) : null;
}

/** 原子写入 Plugin 安装记录。 */
export function set_plugin_installation_row(
  context: PlatformStoreContext,
  installation: InstalledPluginInstallation,
): void {
  context.sqlite.prepare(`
    INSERT INTO plugin_installations (
      installation_id, source, resolved_commit, entry_path, manifest_json,
      integrity, installed_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(installation_id) DO UPDATE SET
      source = excluded.source,
      resolved_commit = excluded.resolved_commit,
      entry_path = excluded.entry_path,
      manifest_json = excluded.manifest_json,
      integrity = excluded.integrity,
      updated_at = excluded.updated_at;
  `).run(
    installation.installation_id,
    installation.source,
    installation.resolved_commit ?? null,
    installation.entry_path,
    JSON.stringify(installation.manifest),
    installation.integrity ?? null,
    installation.installed_at,
    installation.updated_at,
  );
}

/** 删除 Plugin 安装记录。 */
export function remove_plugin_installation_row(
  context: PlatformStoreContext,
  installation_id: string,
): void {
  context.sqlite.prepare(
    "DELETE FROM plugin_installations WHERE installation_id = ?;",
  ).run(installation_id);
}

/** 列出指定 Agent 的全部 Plugin Binding。 */
export function list_agent_plugin_rows(
  context: PlatformStoreContext,
  agent_id: string,
): AgentPluginBinding[] {
  const rows = context.sqlite.prepare(`
    SELECT * FROM agent_plugins WHERE agent_id = ? ORDER BY plugin_name ASC;
  `).all(agent_id) as AgentPluginRow[];
  return rows.map(decode_agent_plugin);
}

/** 按 Agent 与 Plugin 名称读取 Binding。 */
export function get_agent_plugin_row(
  context: PlatformStoreContext,
  agent_id: string,
  plugin_name: string,
): AgentPluginBinding | null {
  const row = context.sqlite.prepare(`
    SELECT * FROM agent_plugins
    WHERE agent_id = ? AND plugin_name = ?
    LIMIT 1;
  `).get(agent_id, plugin_name) as AgentPluginRow | undefined;
  return row ? decode_agent_plugin(row) : null;
}

/** 原子写入 Agent Plugin Binding。 */
export function set_agent_plugin_row(
  context: PlatformStoreContext,
  binding: AgentPluginBinding,
): void {
  context.sqlite.prepare(`
    INSERT INTO agent_plugins (
      agent_id, plugin_name, enabled, config_encrypted, resource_ids_json,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(agent_id, plugin_name) DO UPDATE SET
      enabled = excluded.enabled,
      config_encrypted = excluded.config_encrypted,
      resource_ids_json = excluded.resource_ids_json,
      updated_at = excluded.updated_at;
  `).run(
    binding.agent_id,
    binding.plugin_name,
    binding.enabled ? 1 : 0,
    encryptTextSync(JSON.stringify(binding.config)),
    JSON.stringify(binding.resource_ids),
    binding.created_at,
    binding.updated_at,
  );
}

/** 把持久化 JSON 收窄为唯一、非空 Resource ID 数组。 */
function parse_resource_ids(value: string): string[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) return [];
    return [...new Set(parsed.map((item) => String(item || "").trim()).filter(Boolean))];
  } catch {
    return [];
  }
}

/** 删除 Agent Plugin Binding。 */
export function remove_agent_plugin_row(
  context: PlatformStoreContext,
  agent_id: string,
  plugin_name: string,
): void {
  context.sqlite.prepare(`
    DELETE FROM agent_plugins WHERE agent_id = ? AND plugin_name = ?;
  `).run(agent_id, plugin_name);
}
