/**
 * 本地 Plugin Binding、Resource 与 Installation 仓储。
 *
 * 本模块拥有三组共享表的全部 SQL 和加密规则，并维护删除时的引用完整性。具体
 * Plugin Manifest 与 Resource Schema 的业务校验由调用方在写入前完成。
 */

import type { LocalCrypto } from "@/database/LocalCrypto.js";
import type { LocalDatabase } from "@/database/LocalDatabase.js";
import type { AgentRepository } from "@/repositories/AgentRepository.js";
import type {
  LocalAgentPluginBinding,
  LocalPluginInstallation,
  LocalPluginResource,
} from "@/types/LocalPlugin.js";

/** 本地 Plugin 配置仓储。 */
export class PluginRepository {
  constructor(
    private readonly database: LocalDatabase,
    private readonly crypto_adapter: LocalCrypto,
    private readonly agents: AgentRepository,
  ) {}

  /** 列出一个 Agent 的全部 Plugin Binding。 */
  list_agent_bindings(agent_id_input: string): LocalAgentPluginBinding[] {
    const agent_id = require_text(agent_id_input, "agent_id");
    return this.agents.list_plugin_bindings(agent_id);
  }

  /** 读取一个 Agent 的指定 Plugin Binding。 */
  get_agent_binding(agent_id_input: string, plugin_name_input: string): LocalAgentPluginBinding | null {
    const agent_id = require_text(agent_id_input, "agent_id");
    const plugin_name = normalize_plugin_name(plugin_name_input);
    return this.agents.get_plugin_binding(agent_id, plugin_name);
  }

  /** 原子新建或更新一个 Plugin Binding。 */
  save_agent_binding(input: Omit<LocalAgentPluginBinding, "created_at" | "updated_at">): LocalAgentPluginBinding {
    const agent_id = require_text(input.agent_id, "agent_id");
    const plugin_name = normalize_plugin_name(input.plugin_name);
    if (!this.agents.get(agent_id)) throw new Error(`Agent not found: ${agent_id}`);
    const resource_ids = normalize_resource_ids(input.resource_ids);
    for (const resource_id of resource_ids) this.require_resource(plugin_name, resource_id);
    return this.agents.save_plugin_binding({
      agent_id,
      plugin_name,
      enabled: input.enabled,
      config: input.config,
      resource_ids,
    });
  }

  /** 删除一个 Agent Plugin Binding。 */
  remove_agent_binding(agent_id_input: string, plugin_name_input: string): void {
    this.agents.remove_plugin_binding(
      require_text(agent_id_input, "agent_id"),
      normalize_plugin_name(plugin_name_input),
    );
  }

  /** 列出一个 Plugin 拥有的全部 Resource。 */
  list_resources(plugin_name_input: string): LocalPluginResource[] {
    const plugin_name = normalize_plugin_name(plugin_name_input);
    const rows = this.database.prepare(`
      SELECT * FROM plugin_resources WHERE plugin_name = ? ORDER BY resource_id ASC;
    `).all(plugin_name) as unknown as PluginResourceRow[];
    return rows.map((row) => this.decode_resource(row));
  }

  /** 读取一个 Plugin Resource。 */
  get_resource(plugin_name_input: string, resource_id_input: string): LocalPluginResource | null {
    const plugin_name = normalize_plugin_name(plugin_name_input);
    const resource_id = normalize_resource_id(resource_id_input);
    const row = this.database.prepare(`
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
    this.database.prepare(`
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
    const reference = this.agents.list()
      .flatMap((agent) => this.agents.list_plugin_bindings(agent.agent_id))
      .find((binding) =>
        binding.plugin_name === plugin_name && binding.resource_ids.includes(resource_id)
      );
    if (reference) {
      throw new Error(`Plugin Resource is still bound to agent ${reference.agent_id}: ${resource_id}`);
    }
    this.database.prepare(`
      DELETE FROM plugin_resources WHERE plugin_name = ? AND resource_id = ?;
    `).run(plugin_name, resource_id);
  }

  /** 列出全部第三方 Plugin installation。 */
  list_installations(): LocalPluginInstallation[] {
    const rows = this.database.prepare(`
      SELECT * FROM plugin_installations ORDER BY installation_id ASC;
    `).all() as unknown as PluginInstallationRow[];
    return rows.map(decode_installation);
  }

  /** 按 ID 读取第三方 Plugin installation。 */
  get_installation(installation_id_input: string): LocalPluginInstallation | null {
    const installation_id = normalize_installation_id(installation_id_input);
    const row = this.database.prepare(`
      SELECT * FROM plugin_installations WHERE installation_id = ? LIMIT 1;
    `).get(installation_id) as PluginInstallationRow | undefined;
    return row ? decode_installation(row) : null;
  }

  /** 原子新建或更新第三方 Plugin installation。 */
  save_installation(input: LocalPluginInstallation): LocalPluginInstallation {
    const installation = { ...input, installation_id: normalize_installation_id(input.installation_id) };
    this.database.prepare(`
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
      const binding = this.find_binding(manifest.name);
      if (binding) throw new Error(`Plugin is still bound to agent ${binding.agent_id}: ${manifest.name}`);
      const resource = this.database.prepare(
        "SELECT resource_id FROM plugin_resources WHERE plugin_name = ? LIMIT 1;",
      ).get(manifest.name) as { resource_id: string } | undefined;
      if (resource) throw new Error(`Plugin still owns Resource ${resource.resource_id}: ${manifest.name}`);
    }
    this.database.prepare(
      "DELETE FROM plugin_installations WHERE installation_id = ?;",
    ).run(installation.installation_id);
    return installation;
  }

  /** 断言一个 Plugin 没有任何 Binding 或 Resource，可用于安装更新兼容检查。 */
  assert_plugin_unused(plugin_name_input: string): void {
    const plugin_name = normalize_plugin_name(plugin_name_input);
    const binding = this.find_binding(plugin_name);
    if (binding) throw new Error(`Plugin is still bound to agent ${binding.agent_id}: ${plugin_name}`);
    const resource = this.database.prepare(
      "SELECT resource_id FROM plugin_resources WHERE plugin_name = ? LIMIT 1;",
    ).get(plugin_name) as { resource_id: string } | undefined;
    if (resource) throw new Error(`Plugin still owns Resource ${resource.resource_id}: ${plugin_name}`);
  }

  /** 解密并恢复 Plugin Resource。 */
  private decode_resource(row: PluginResourceRow): LocalPluginResource {
    const item = JSON.parse(this.crypto_adapter.decrypt(row.item_encrypted)) as LocalPluginResource["item"];
    if (item.id !== row.resource_id) {
      throw new Error(`Plugin Resource identity mismatch: ${row.plugin_name}/${row.resource_id}`);
    }
    return { ...row, item };
  }

  /** 查找引用指定 Plugin 的第一个 Agent Binding。 */
  private find_binding(plugin_name: string): LocalAgentPluginBinding | undefined {
    return this.agents.list()
      .flatMap((agent) => this.agents.list_plugin_bindings(agent.agent_id))
      .find((binding) => binding.plugin_name === plugin_name);
  }

  /** 断言 Binding 引用的 Resource 存在。 */
  private require_resource(plugin_name: string, resource_id: string): void {
    if (!this.get_resource(plugin_name, resource_id)) {
      throw new Error(`Plugin Resource not found: ${plugin_name}/${resource_id}`);
    }
  }

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

/** 要求字符串字段非空。 */
function require_text(value: string, field_name: string): string {
  const normalized = String(value || "").trim();
  if (!normalized) throw new Error(`${field_name} is required`);
  return normalized;
}
