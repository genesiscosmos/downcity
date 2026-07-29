/**
 * PlatformStore Plugin Resource 仓储。
 *
 * 关键点（中文）
 * - Resource Item 作为一个完整 JSON 对象加密保存，避免字段级存储与 Plugin Schema 漂移。
 * - `plugin_name + resource_id` 是唯一身份，数据库列只承担索引与一致性检查。
 * - 仓储不理解 Resource 类型、动态字段或 Plugin 业务。
 */

import type { PlatformStoreContext } from "@/city/runtime/store/StoreShared.js";
import { decryptTextSync, encryptTextSync } from "@/city/runtime/store/crypto.js";
import type {
  PluginResourceItem,
  PluginResourceRecord,
} from "@/city/types/plugin/PluginResource.js";

interface PluginResourceRow {
  /** Plugin 名称。 */
  plugin_name: string;

  /** Resource ID。 */
  resource_id: string;

  /** 加密后的完整 Resource Item。 */
  item_encrypted: string;

  /** 创建时间。 */
  created_at: string;

  /** 更新时间。 */
  updated_at: string;
}

/** 列出一个 Plugin 的全部 Resource。 */
export function list_plugin_resource_rows(
  context: PlatformStoreContext,
  plugin_name: string,
): PluginResourceRecord[] {
  const rows = context.sqlite.prepare(`
    SELECT * FROM plugin_resources
    WHERE plugin_name = ?
    ORDER BY resource_id ASC;
  `).all(plugin_name) as PluginResourceRow[];
  return rows.map(decode_plugin_resource_row);
}

/** 读取一个 Plugin Resource。 */
export function get_plugin_resource_row(
  context: PlatformStoreContext,
  plugin_name: string,
  resource_id: string,
): PluginResourceRecord | null {
  const row = context.sqlite.prepare(`
    SELECT * FROM plugin_resources
    WHERE plugin_name = ? AND resource_id = ?
    LIMIT 1;
  `).get(plugin_name, resource_id) as PluginResourceRow | undefined;
  return row ? decode_plugin_resource_row(row) : null;
}

/** 原子保存一个完整 Plugin Resource。 */
export function set_plugin_resource_row(
  context: PlatformStoreContext,
  resource: PluginResourceRecord,
): void {
  context.sqlite.prepare(`
    INSERT INTO plugin_resources (
      plugin_name, resource_id, item_encrypted, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(plugin_name, resource_id) DO UPDATE SET
      item_encrypted = excluded.item_encrypted,
      updated_at = excluded.updated_at;
  `).run(
    resource.plugin_name,
    resource.resource_id,
    encryptTextSync(JSON.stringify(resource.item)),
    resource.created_at,
    resource.updated_at,
  );
}

/** 删除一个 Plugin Resource。 */
export function remove_plugin_resource_row(
  context: PlatformStoreContext,
  plugin_name: string,
  resource_id: string,
): void {
  context.sqlite.prepare(`
    DELETE FROM plugin_resources
    WHERE plugin_name = ? AND resource_id = ?;
  `).run(plugin_name, resource_id);
}

/** 将数据库行解密并恢复为完整领域记录。 */
function decode_plugin_resource_row(row: PluginResourceRow): PluginResourceRecord {
  const item = JSON.parse(decryptTextSync(row.item_encrypted)) as PluginResourceItem;
  if (item.id !== row.resource_id) {
    throw new Error(
      `Plugin Resource identity mismatch: ${row.plugin_name}/${row.resource_id}`,
    );
  }
  return {
    plugin_name: row.plugin_name,
    resource_id: row.resource_id,
    item,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}
