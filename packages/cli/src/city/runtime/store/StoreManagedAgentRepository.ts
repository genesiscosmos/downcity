/**
 * ManagedAgent 加密行存储。
 *
 * 关键点（中文）
 * - `agent_id` 是唯一主键，Workspace 路径只建立普通索引。
 * - 完整配置使用平台 AES-256-GCM 密钥加密。
 * - 本模块只处理 SQLite 行，不承担输入规范化和业务冲突判断。
 */

import type { PlatformStoreContext } from "@/city/runtime/store/StoreShared.js";
import { decryptTextSync, encryptTextSync } from "@/city/runtime/store/crypto.js";
import type { ManagedAgent } from "@/city/types/agent/ManagedAgent.js";

/** 解密数据库中的完整 Agent 配置。 */
function decode_managed_agent(value_encrypted: unknown): ManagedAgent | null {
  if (typeof value_encrypted !== "string" || !value_encrypted) return null;
  return JSON.parse(decryptTextSync(value_encrypted)) as ManagedAgent;
}

/** 按全局 Agent ID 读取一条记录。 */
export function get_managed_agent_row(
  context: PlatformStoreContext,
  agent_id: string,
): ManagedAgent | null {
  const row = context.sqlite.prepare(`
    SELECT config_encrypted
    FROM managed_agents
    WHERE agent_id = ?
    LIMIT 1;
  `).get(agent_id) as { config_encrypted?: unknown } | undefined;
  return decode_managed_agent(row?.config_encrypted);
}

/** 按 Workspace 路径读取全部绑定记录。 */
export function list_managed_agent_rows_by_workspace(
  context: PlatformStoreContext,
  workspace_path: string,
): ManagedAgent[] {
  const rows = context.sqlite.prepare(`
    SELECT config_encrypted
    FROM managed_agents
    WHERE workspace_path = ?
    ORDER BY agent_id ASC;
  `).all(workspace_path) as Array<{ config_encrypted?: unknown }>;
  return rows
    .map((row) => decode_managed_agent(row.config_encrypted))
    .filter((agent): agent is ManagedAgent => agent !== null);
}

/** 列出全部受管 Agent。 */
export function list_managed_agent_rows(
  context: PlatformStoreContext,
): ManagedAgent[] {
  const rows = context.sqlite.prepare(`
    SELECT config_encrypted
    FROM managed_agents
    ORDER BY agent_id ASC;
  `).all() as Array<{ config_encrypted?: unknown }>;
  return rows
    .map((row) => decode_managed_agent(row.config_encrypted))
    .filter((agent): agent is ManagedAgent => agent !== null);
}

/** 原子写入完整受管 Agent 配置。 */
export function set_managed_agent_row(
  context: PlatformStoreContext,
  agent: ManagedAgent,
): void {
  const config_encrypted = encryptTextSync(JSON.stringify(agent));
  context.sqlite.prepare(`
    INSERT INTO managed_agents (
      agent_id,
      workspace_path,
      config_encrypted,
      created_at,
      updated_at
    ) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(agent_id) DO UPDATE SET
      workspace_path = excluded.workspace_path,
      config_encrypted = excluded.config_encrypted,
      updated_at = excluded.updated_at;
  `).run(
    agent.agent_id,
    agent.workspace_path,
    config_encrypted,
    agent.created_at,
    agent.updated_at,
  );
}

/** 删除一个受管 Agent。 */
export function remove_managed_agent_row(
  context: PlatformStoreContext,
  agent_id: string,
): void {
  context.sqlite.prepare(
    "DELETE FROM managed_agents WHERE agent_id = ?;",
  ).run(agent_id);
}
