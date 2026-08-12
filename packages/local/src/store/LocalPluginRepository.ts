/**
 * 本地 Plugin Binding、Resource 与 Installation 仓储。
 *
 * 本模块拥有三组共享表的全部 SQL 和加密规则，并维护删除时的引用完整性。具体
 * Plugin Manifest 与 Resource Schema 的业务校验由调用方在写入前完成。
 */

import type { JsonObject } from "@downcity/agent";
import type { LocalCrypto } from "@/store/LocalCrypto.js";
import type { LocalDatabase } from "@/store/LocalDatabase.js";
import type {
  LocalAgentPluginBinding,
  LocalPluginInstallation,
  LocalPluginResource,
} from "@/types/LocalPlugin.js";

/** 本地 Plugin 配置仓储。 */
export class LocalPluginRepository {
  constructor(
    private readonly database: LocalDatabase,
    private readonly crypto_adapter: LocalCrypto,
  ) {}

  /** 把旧 Chat Account 与 Binding 一次性迁移成 Resource 协议。 */
  migrate_legacy_chat_resources(): void {
    if (!this.table_exists("channel_accounts")) return;
    this.database.sqlite.exec("BEGIN IMMEDIATE;");
    try {
      this.migrate_channel_accounts();
      const rows = this.database.sqlite.prepare(`
        SELECT agent_id, config_encrypted, resource_ids_json
        FROM agent_plugins WHERE plugin_name = 'chat';
      `).all() as Array<{
        agent_id: string;
        config_encrypted: string;
        resource_ids_json: string;
      }>;
      const update = this.database.sqlite.prepare(`
        UPDATE agent_plugins
        SET config_encrypted = ?, resource_ids_json = ?, updated_at = ?
        WHERE agent_id = ? AND plugin_name = 'chat';
      `);
      const current_time = new Date().toISOString();
      for (const row of rows) {
        const config = JSON.parse(this.crypto_adapter.decrypt(row.config_encrypted)) as Record<string, unknown>;
        let changed = false;
        const queue = as_record(config.queue);
        if (queue) {
          changed = move_record_field(queue, "maxConcurrency", "max_concurrency") || changed;
          changed = move_record_field(queue, "mergeDebounceMs", "merge_debounce_ms") || changed;
          changed = move_record_field(queue, "mergeMaxWaitMs", "merge_max_wait_ms") || changed;
        }
        const resource_ids = parse_string_array(row.resource_ids_json);
        const channels = as_record(config.channels);
        if (channels) {
          for (const value of Object.values(channels)) {
            const channel = as_record(value);
            if (!channel) continue;
            changed = move_record_field(channel, "channelAccountId", "channel_account_id") || changed;
            const resource_id = String(channel.channel_account_id || "").trim();
            if (
              channel.enabled === true
              && resource_id
              && this.get_resource("chat", resource_id)
              && !resource_ids.includes(resource_id)
            ) resource_ids.push(resource_id);
          }
          delete config.channels;
          changed = true;
        }
        if (changed) {
          update.run(
            this.crypto_adapter.encrypt(JSON.stringify(config)),
            JSON.stringify(resource_ids),
            current_time,
            row.agent_id,
          );
        }
      }
      this.database.sqlite.exec("DROP TABLE channel_accounts;");
      this.database.sqlite.exec("COMMIT;");
    } catch (error) {
      this.database.sqlite.exec("ROLLBACK;");
      throw error;
    }
  }

  /** 列出一个 Agent 的全部 Plugin Binding。 */
  list_agent_bindings(agent_id_input: string): LocalAgentPluginBinding[] {
    const agent_id = require_text(agent_id_input, "agent_id");
    this.require_agent(agent_id);
    const rows = this.database.sqlite.prepare(`
      SELECT * FROM agent_plugins WHERE agent_id = ? ORDER BY plugin_name ASC;
    `).all(agent_id) as unknown as AgentPluginRow[];
    return rows.map((row) => this.decode_binding(row));
  }

  /** 读取一个 Agent 的指定 Plugin Binding。 */
  get_agent_binding(agent_id_input: string, plugin_name_input: string): LocalAgentPluginBinding | null {
    const agent_id = require_text(agent_id_input, "agent_id");
    const plugin_name = normalize_plugin_name(plugin_name_input);
    this.require_agent(agent_id);
    const row = this.database.sqlite.prepare(`
      SELECT * FROM agent_plugins WHERE agent_id = ? AND plugin_name = ? LIMIT 1;
    `).get(agent_id, plugin_name) as AgentPluginRow | undefined;
    return row ? this.decode_binding(row) : null;
  }

  /** 原子新建或更新一个 Plugin Binding。 */
  save_agent_binding(input: Omit<LocalAgentPluginBinding, "created_at" | "updated_at">): LocalAgentPluginBinding {
    const agent_id = require_text(input.agent_id, "agent_id");
    const plugin_name = normalize_plugin_name(input.plugin_name);
    this.require_agent(agent_id);
    const resource_ids = normalize_resource_ids(input.resource_ids);
    for (const resource_id of resource_ids) this.require_resource(plugin_name, resource_id);
    const existing = this.get_agent_binding(agent_id, plugin_name);
    const current_time = new Date().toISOString();
    const binding: LocalAgentPluginBinding = {
      agent_id,
      plugin_name,
      enabled: input.enabled,
      config: input.config,
      resource_ids,
      created_at: existing?.created_at ?? current_time,
      updated_at: current_time,
    };
    this.database.sqlite.prepare(`
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
      this.crypto_adapter.encrypt(JSON.stringify(binding.config)),
      JSON.stringify(binding.resource_ids),
      binding.created_at,
      binding.updated_at,
    );
    return binding;
  }

  /** 删除一个 Agent Plugin Binding。 */
  remove_agent_binding(agent_id_input: string, plugin_name_input: string): void {
    this.database.sqlite.prepare(`
      DELETE FROM agent_plugins WHERE agent_id = ? AND plugin_name = ?;
    `).run(require_text(agent_id_input, "agent_id"), normalize_plugin_name(plugin_name_input));
  }

  /** 列出一个 Plugin 拥有的全部 Resource。 */
  list_resources(plugin_name_input: string): LocalPluginResource[] {
    const plugin_name = normalize_plugin_name(plugin_name_input);
    const rows = this.database.sqlite.prepare(`
      SELECT * FROM plugin_resources WHERE plugin_name = ? ORDER BY resource_id ASC;
    `).all(plugin_name) as unknown as PluginResourceRow[];
    return rows.map((row) => this.decode_resource(row));
  }

  /** 读取一个 Plugin Resource。 */
  get_resource(plugin_name_input: string, resource_id_input: string): LocalPluginResource | null {
    const plugin_name = normalize_plugin_name(plugin_name_input);
    const resource_id = normalize_resource_id(resource_id_input);
    const row = this.database.sqlite.prepare(`
      SELECT * FROM plugin_resources
      WHERE plugin_name = ? AND resource_id = ? LIMIT 1;
    `).get(plugin_name, resource_id) as PluginResourceRow | undefined;
    return row ? this.decode_resource(row) : null;
  }

  /** 原子新建或更新一个完整 Plugin Resource。 */
  save_resource(input: { plugin_name: string; item: LocalPluginResource["item"] }): LocalPluginResource {
    const plugin_name = normalize_plugin_name(input.plugin_name);
    const resource_id = normalize_resource_id(input.item.id);
    if (input.item.id !== resource_id) throw new Error(`Plugin Resource id is not canonical: ${input.item.id}`);
    const existing = this.get_resource(plugin_name, resource_id);
    const current_time = new Date().toISOString();
    const resource: LocalPluginResource = {
      plugin_name,
      resource_id,
      item: input.item,
      created_at: existing?.created_at ?? current_time,
      updated_at: current_time,
    };
    this.database.sqlite.prepare(`
      INSERT INTO plugin_resources (
        plugin_name, resource_id, item_encrypted, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(plugin_name, resource_id) DO UPDATE SET
        item_encrypted = excluded.item_encrypted,
        updated_at = excluded.updated_at;
    `).run(
      resource.plugin_name,
      resource.resource_id,
      this.crypto_adapter.encrypt(JSON.stringify(resource.item)),
      resource.created_at,
      resource.updated_at,
    );
    return resource;
  }

  /** 删除一个未被任何 Agent Binding 引用的 Plugin Resource。 */
  remove_resource(plugin_name_input: string, resource_id_input: string): void {
    const plugin_name = normalize_plugin_name(plugin_name_input);
    const resource_id = normalize_resource_id(resource_id_input);
    const rows = this.database.sqlite.prepare(`
      SELECT agent_id, resource_ids_json FROM agent_plugins WHERE plugin_name = ?;
    `).all(plugin_name) as Array<{ agent_id: string; resource_ids_json: string }>;
    const reference = rows.find((row) => parse_string_array(row.resource_ids_json).includes(resource_id));
    if (reference) {
      throw new Error(`Plugin Resource is still bound to agent ${reference.agent_id}: ${resource_id}`);
    }
    this.database.sqlite.prepare(`
      DELETE FROM plugin_resources WHERE plugin_name = ? AND resource_id = ?;
    `).run(plugin_name, resource_id);
  }

  /** 列出全部第三方 Plugin installation。 */
  list_installations(): LocalPluginInstallation[] {
    const rows = this.database.sqlite.prepare(`
      SELECT * FROM plugin_installations ORDER BY installation_id ASC;
    `).all() as unknown as PluginInstallationRow[];
    return rows.map(decode_installation);
  }

  /** 按 ID 读取第三方 Plugin installation。 */
  get_installation(installation_id_input: string): LocalPluginInstallation | null {
    const installation_id = normalize_installation_id(installation_id_input);
    const row = this.database.sqlite.prepare(`
      SELECT * FROM plugin_installations WHERE installation_id = ? LIMIT 1;
    `).get(installation_id) as PluginInstallationRow | undefined;
    return row ? decode_installation(row) : null;
  }

  /** 原子新建或更新第三方 Plugin installation。 */
  save_installation(input: LocalPluginInstallation): LocalPluginInstallation {
    const installation = { ...input, installation_id: normalize_installation_id(input.installation_id) };
    this.database.sqlite.prepare(`
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
      installation.integrity || null,
      installation.installed_at,
      installation.updated_at,
    );
    return installation;
  }

  /** 删除一个没有 Binding 或 Resource 引用的共享 installation。 */
  remove_installation(installation_id_input: string): LocalPluginInstallation {
    const installation = this.get_installation(installation_id_input);
    if (!installation) throw new Error(`Plugin installation not found: ${installation_id_input}`);
    for (const manifest of installation.manifest.plugins) {
      const binding = this.database.sqlite.prepare(
        "SELECT agent_id FROM agent_plugins WHERE plugin_name = ? LIMIT 1;",
      ).get(manifest.name) as { agent_id: string } | undefined;
      if (binding) throw new Error(`Plugin is still bound to agent ${binding.agent_id}: ${manifest.name}`);
      const resource = this.database.sqlite.prepare(
        "SELECT resource_id FROM plugin_resources WHERE plugin_name = ? LIMIT 1;",
      ).get(manifest.name) as { resource_id: string } | undefined;
      if (resource) throw new Error(`Plugin still owns Resource ${resource.resource_id}: ${manifest.name}`);
    }
    this.database.sqlite.prepare(
      "DELETE FROM plugin_installations WHERE installation_id = ?;",
    ).run(installation.installation_id);
    return installation;
  }

  /** 断言一个 Plugin 没有任何 Binding 或 Resource，可用于安装更新兼容检查。 */
  assert_plugin_unused(plugin_name_input: string): void {
    const plugin_name = normalize_plugin_name(plugin_name_input);
    const binding = this.database.sqlite.prepare(
      "SELECT agent_id FROM agent_plugins WHERE plugin_name = ? LIMIT 1;",
    ).get(plugin_name) as { agent_id: string } | undefined;
    if (binding) throw new Error(`Plugin is still bound to agent ${binding.agent_id}: ${plugin_name}`);
    const resource = this.database.sqlite.prepare(
      "SELECT resource_id FROM plugin_resources WHERE plugin_name = ? LIMIT 1;",
    ).get(plugin_name) as { resource_id: string } | undefined;
    if (resource) throw new Error(`Plugin still owns Resource ${resource.resource_id}: ${plugin_name}`);
  }

  /** 解密并恢复 Plugin Binding。 */
  private decode_binding(row: AgentPluginRow): LocalAgentPluginBinding {
    return {
      agent_id: row.agent_id,
      plugin_name: row.plugin_name,
      enabled: row.enabled === 1,
      config: JSON.parse(this.crypto_adapter.decrypt(row.config_encrypted)) as JsonObject,
      resource_ids: parse_string_array(row.resource_ids_json),
      created_at: row.created_at,
      updated_at: row.updated_at,
    };
  }

  /** 解密并恢复 Plugin Resource。 */
  private decode_resource(row: PluginResourceRow): LocalPluginResource {
    const item = JSON.parse(this.crypto_adapter.decrypt(row.item_encrypted)) as LocalPluginResource["item"];
    if (item.id !== row.resource_id) {
      throw new Error(`Plugin Resource identity mismatch: ${row.plugin_name}/${row.resource_id}`);
    }
    return { ...row, item };
  }

  /** 断言 Agent 配置存在。 */
  private require_agent(agent_id: string): void {
    const found = this.database.sqlite.prepare(
      "SELECT 1 FROM managed_agents WHERE agent_id = ? LIMIT 1;",
    ).get(agent_id);
    if (!found) throw new Error(`Agent not found: ${agent_id}`);
  }

  /** 断言 Binding 引用的 Resource 存在。 */
  private require_resource(plugin_name: string, resource_id: string): void {
    if (!this.get_resource(plugin_name, resource_id)) {
      throw new Error(`Plugin Resource not found: ${plugin_name}/${resource_id}`);
    }
  }

  /** 把旧 Channel Account 行写成 Chat Plugin Resource。 */
  private migrate_channel_accounts(): void {
    const rows = this.database.sqlite.prepare("SELECT * FROM channel_accounts;").all() as Array<Record<string, unknown>>;
    const insert = this.database.sqlite.prepare(`
      INSERT OR IGNORE INTO plugin_resources (
        plugin_name, resource_id, item_encrypted, created_at, updated_at
      ) VALUES ('chat', ?, ?, ?, ?);
    `);
    for (const row of rows) {
      const id = String(row.id || "").trim();
      const type = String(row.channel || "").trim();
      if (!id || !["telegram", "feishu", "qq"].includes(type)) continue;
      const item: Record<string, unknown> = { id, type, name: String(row.name || "").trim() || id };
      const bot_token = this.decrypt_optional(row.bot_token_encrypted);
      const app_id = this.decrypt_optional(row.app_id_encrypted);
      const app_secret = this.decrypt_optional(row.app_secret_encrypted);
      const identity = String(row.identity || "").trim();
      const owner = String(row.owner || "").trim();
      const creator = String(row.creator || "").trim();
      const domain = String(row.domain || "").trim();
      if (bot_token) item.bot_token = bot_token;
      if (app_id) item.app_id = app_id;
      if (app_secret) item.app_secret = app_secret;
      if (type === "telegram" && identity) item.username = identity;
      if (type !== "telegram" && identity) item.identity = identity;
      if (type === "feishu" && owner) item.owner = owner;
      if (type === "feishu" && creator) item.creator = creator;
      if (type === "feishu" && domain) item.domain = domain;
      if (type === "qq" && Number(row.sandbox || 0) === 1) item.sandbox = true;
      if (!(type === "telegram" ? bot_token : app_id && app_secret)) continue;
      const created_at = String(row.created_at || "").trim() || new Date().toISOString();
      const updated_at = String(row.updated_at || "").trim() || created_at;
      insert.run(id, this.crypto_adapter.encrypt(JSON.stringify(item)), created_at, updated_at);
    }
  }

  /** 解密旧表中的可选凭据列。 */
  private decrypt_optional(value: unknown): string | undefined {
    if (typeof value !== "string" || !value) return undefined;
    return this.crypto_adapter.decrypt(value).trim() || undefined;
  }

  /** 判断兼容表是否存在。 */
  private table_exists(table_name: string): boolean {
    return Boolean(this.database.sqlite.prepare(`
      SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ? LIMIT 1;
    `).get(table_name));
  }
}

interface AgentPluginRow extends Omit<LocalAgentPluginBinding, "enabled" | "config" | "resource_ids"> {
  /** SQLite 整数布尔值。 */
  enabled: number;
  /** 加密后的 Plugin 配置。 */
  config_encrypted: string;
  /** Resource ID JSON 数组。 */
  resource_ids_json: string;
}

interface PluginResourceRow extends Omit<LocalPluginResource, "item"> {
  /** 加密后的完整 Resource Item。 */
  item_encrypted: string;
}

interface PluginInstallationRow extends Omit<LocalPluginInstallation, "resolved_commit" | "manifest" | "integrity"> {
  /** 可空 Git commit SHA。 */
  resolved_commit: string | null;
  /** Manifest JSON 字符串。 */
  manifest_json: string;
  /** 可空制品摘要。 */
  integrity: string | null;
}

/** 把 SQLite 行恢复为 installation。 */
function decode_installation(row: PluginInstallationRow): LocalPluginInstallation {
  return {
    installation_id: row.installation_id,
    source: row.source,
    ...(row.resolved_commit ? { resolved_commit: row.resolved_commit } : {}),
    entry_path: row.entry_path,
    manifest: JSON.parse(row.manifest_json) as LocalPluginInstallation["manifest"],
    integrity: row.integrity ?? "",
    installed_at: row.installed_at,
    updated_at: row.updated_at,
  };
}

/** 规范化 Plugin 名称。 */
export function normalize_plugin_name(input: string): string {
  const value = String(input || "").trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9_-]*$/u.test(value)) throw new Error(`Invalid Plugin name: ${input}`);
  return value;
}

/** 规范化 Plugin installation ID。 */
export function normalize_installation_id(input: string): string {
  const value = String(input || "").trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9_-]*$/u.test(value)) throw new Error(`Invalid Plugin installation id: ${input}`);
  return value;
}

/** 规范化 Plugin Resource ID。 */
export function normalize_resource_id(input: string): string {
  const value = String(input || "").trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9_-]{0,79}$/u.test(value)) throw new Error(`Invalid Plugin Resource id: ${input}`);
  return value;
}

/** 规范化唯一 Resource ID 数组。 */
function normalize_resource_ids(input: readonly string[]): string[] {
  const values = input.map(normalize_resource_id);
  if (new Set(values).size !== values.length) throw new Error("Plugin Binding resource_ids must be unique");
  return values;
}

/** 解析持久化字符串数组。 */
function parse_string_array(value: string): string[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed)
      ? [...new Set(parsed.map((item) => String(item || "").trim()).filter(Boolean))]
      : [];
  } catch {
    return [];
  }
}

/** 要求字符串字段非空。 */
function require_text(value: string, field_name: string): string {
  const normalized = String(value || "").trim();
  if (!normalized) throw new Error(`${field_name} is required`);
  return normalized;
}

/** 把旧字段移动为 snake_case 字段。 */
function move_record_field(record: Record<string, unknown>, old_key: string, new_key: string): boolean {
  if (!Object.prototype.hasOwnProperty.call(record, old_key)) return false;
  if (!Object.prototype.hasOwnProperty.call(record, new_key)) record[new_key] = record[old_key];
  delete record[old_key];
  return true;
}

/** 把未知值收窄为普通对象。 */
function as_record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}
