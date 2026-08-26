/** 本地 Group 定义仓储；只管理配置，不创建 Agent 或运行时 Group。 */

import type { LocalDatabase } from "@/database/LocalDatabase.js";
import type { LocalGroupConfig } from "@/types/LocalConfig.js";

interface GroupRow {
  /** Group 稳定 ID。 */
  group_id: string;
  /** 明文 JSON 配置。 */
  config_json: string;
  /** 创建时间。 */
  created_at: string;
  /** 更新时间。 */
  updated_at: string;
}

/** 管理 Desktop Group 的持久化定义。 */
export class GroupRepository {
  constructor(private readonly database: LocalDatabase) {}

  /** 创建一个 Group 定义；重复 ID 直接失败。 */
  create(input: {
    /** Group 稳定 ID。 */
    group_id: string;
    /** Group 展示名称。 */
    name?: string;
    /** Group 协作目标。 */
    instruction?: string;
    /** Group 成员 Agent ID。 */
    member_agent_ids: readonly string[];
    /** Group 使用的共享 Workspace ID；未填写时使用内存执行上下文。 */
    workspace_id?: string;
  }): LocalGroupConfig {
    const group_id = normalize_group_id(input.group_id);
    if (this.get(group_id)) throw new Error(`Group already exists: ${group_id}`);
    const member_agent_ids = normalize_member_agent_ids(input.member_agent_ids);
    if (member_agent_ids.length === 0) throw new Error("Group requires at least one member Agent");
    const current_time = new Date().toISOString();
    const config: LocalGroupConfig = {
      group_id,
      name: String(input.name || group_id).trim() || group_id,
      instruction: String(input.instruction || "").trim(),
      member_agent_ids,
      ...(normalize_workspace_id(input.workspace_id) ? { workspace_id: normalize_workspace_id(input.workspace_id) } : {}),
      created_at: current_time,
      updated_at: current_time,
    };
    this.write(config);
    return config;
  }

  /** 列出全部 Group 定义。 */
  list(): LocalGroupConfig[] {
    const rows = this.database.prepare("SELECT group_id, config_json, created_at, updated_at FROM groups ORDER BY group_id ASC;").all() as unknown as GroupRow[];
    return rows.map((row) => this.decode(row));
  }

  /** 按 ID读取 Group 定义。 */
  get(group_id_input: string): LocalGroupConfig | null {
    const group_id = normalize_group_id(group_id_input);
    const row = this.database.prepare("SELECT group_id, config_json, created_at, updated_at FROM groups WHERE group_id = ? LIMIT 1;").get(group_id) as GroupRow | undefined;
    return row ? this.decode(row) : null;
  }

  /** 更新 Group 定义；Group ID 不可修改。 */
  update(group_id_input: string, input: {
    /** Group 展示名称。 */
    name?: string;
    /** Group 协作目标。 */
    instruction?: string;
    /** Group 成员 Agent ID。 */
    member_agent_ids: readonly string[];
    /** Group 使用的共享 Workspace ID；未填写时使用内存执行上下文。 */
    workspace_id?: string;
  }): LocalGroupConfig {
    const current = this.get(group_id_input);
    if (!current) throw new Error(`Group not found: ${group_id_input}`);
    const member_agent_ids = normalize_member_agent_ids(input.member_agent_ids);
    if (member_agent_ids.length === 0) throw new Error("Group requires at least one member Agent");
    const config: LocalGroupConfig = {
      ...current,
      name: String(input.name || current.group_id).trim() || current.group_id,
      instruction: String(input.instruction || "").trim(),
      member_agent_ids,
      workspace_id: normalize_workspace_id(input.workspace_id),
      updated_at: new Date().toISOString(),
    };
    this.write(config);
    return config;
  }

  /** 删除 Group 定义。 */
  remove(group_id_input: string): boolean {
    return this.database.prepare("DELETE FROM groups WHERE group_id = ?;").run(normalize_group_id(group_id_input)).changes > 0;
  }

  private write(config: LocalGroupConfig): void {
    this.database.prepare(`
      INSERT INTO groups (group_id, config_json, created_at, updated_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(group_id) DO UPDATE SET config_json = excluded.config_json, updated_at = excluded.updated_at;
    `).run(config.group_id, JSON.stringify(config), config.created_at, config.updated_at);
  }

  private decode(row: GroupRow): LocalGroupConfig {
    const raw = JSON.parse(row.config_json) as Partial<LocalGroupConfig>;
    return {
      group_id: row.group_id,
      name: String(raw.name || row.group_id).trim() || row.group_id,
      instruction: String(raw.instruction || ""),
      member_agent_ids: normalize_member_agent_ids(raw.member_agent_ids || []),
      ...(normalize_workspace_id(raw.workspace_id) ? { workspace_id: normalize_workspace_id(raw.workspace_id) } : {}),
      created_at: String(raw.created_at || row.created_at),
      updated_at: String(raw.updated_at || row.updated_at),
    };
  }
}

/** 规范化 Group ID。 */
export function normalize_group_id(input: string): string {
  const group_id = String(input || "").trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9_-]*$/u.test(group_id)) throw new Error(`Invalid group_id: ${input}`);
  return group_id;
}

function normalize_member_agent_ids(input: readonly string[]): string[] {
  return [...new Set((input || []).map((agent_id) => String(agent_id || "").trim()).filter(Boolean))];
}

/** 规范化可选 Workspace ID。 */
function normalize_workspace_id(input: unknown): string | undefined {
  const workspace_id = String(input || "").trim();
  return workspace_id || undefined;
}
