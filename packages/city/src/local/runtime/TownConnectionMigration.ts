/**
 * 将既有 Desktop/CLI 连接和账户收集到 Town 事实源。
 * 迁移只依据持久配置建立连接与账户，不访问网络、不推断历史模型或任务来源；
 * 原始值完整归档，未知主体保持待核验，不因当前模型目录唯一而补造来源。
 */
import { randomUUID } from "node:crypto";
import type { StoredTownAccount, TownConnection, TownConnectionState, TownMigrationSettings } from "../types/TownConnection.js";

/** Town 连接的唯一持久设置键。 */
export const TOWN_CONNECTION_STATE_KEY = "town.connections.v1";

/** 规范 endpoint，同时保留部署前缀路径；不允许 URL 内夹带认证信息。 */
export function normalize_town_url(value: string): string {
  const url = new URL(value.trim());
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new TypeError("Downtown URL must be HTTP(S) without credentials, query or fragment");
  }
  return url.toString().replace(/\/+$/u, "");
}

/** 必须由仓储在一个数据库事务内调用。 */
export function migrate_town_connections(settings: TownMigrationSettings): TownConnectionState {
  const existing = settings.get<TownConnectionState>(TOWN_CONNECTION_STATE_KEY);
  if (existing) {
    if (existing.version !== 1) throw new Error("Unsupported Town connection storage version");
    return existing;
  }
  const config_value = settings.get<unknown>("downcity.config");
  const vault_value = settings.get<unknown>("desktop.user-accounts");
  const config = object_value(config_value);
  const vault = object_value(vault_value);
  const now = new Date().toISOString();
  const state: TownConnectionState = { version: 1, connections: {}, accounts: {} };
  const by_url = new Map<string, TownConnection>();
  const old_accounts = new Map<string, StoredTownAccount>();

  const connection_for = (raw_url: unknown, name?: unknown): TownConnection | undefined => {
    if (typeof raw_url !== "string" || !raw_url.trim()) return undefined;
    let url: string;
    try { url = normalize_town_url(raw_url); } catch { return undefined; }
    const known = by_url.get(url);
    if (known) return known;
    const connection: TownConnection = {
      connection_id: randomUUID(), name: text_value(name) || url, url,
      status: "active", revision: 1, source: "remote", created_at: now, updated_at: now,
    };
    by_url.set(url, connection);
    state.connections[connection.connection_id] = connection;
    return connection;
  };
  const import_account = (connection: TownConnection, item: Record<string, unknown>): StoredTownAccount | undefined => {
    const token = text_value(item.user_token);
    const user_id = text_value(item.user_id);
    const session_id = text_value(item.session_id) || undefined;
    // 同一主体或完全相同的未知凭据可以去重，邮箱/昵称不是身份依据。
    const known = Object.values(state.accounts).find((account) => account.connection_id === connection.connection_id
      && (user_id ? account.user_id === user_id : !account.user_id && account.user_token === token && account.session_id === session_id));
    if (known) return known;
    if (!user_id && !token && !session_id) return undefined;
    const account: StoredTownAccount = {
      account_id: randomUUID(), connection_id: connection.connection_id, url: connection.url, user_id,
      ...(user_id ? { auth_scope_id: randomUUID() } : {}),
      ...(token ? { user_token: token } : {}),
      session_id, display_name: text_value(item.display_name) || text_value(item.user_label) || undefined,
      email: text_value(item.email) || undefined, avatar_url: text_value(item.avatar_url) || undefined,
      last_used_at: typeof item.last_used_at === "number" && Number.isFinite(item.last_used_at) ? item.last_used_at : 0,
    };
    state.accounts[account.account_id] = account;
    return account;
  };
  const select = (connection: TownConnection, account: StoredTownAccount) => {
    connection.account_id = account.account_id;
    connection.auth_scope_id = account.auth_scope_id;
  };

  for (const profile of Array.isArray(config.profiles) ? config.profiles : []) {
    const item = object_value(profile);
    connection_for(item.federation_url, item.name);
  }
  connection_for(config.selected_federation_url);
  // 先保留 Desktop 的全部历史账户，再用显式共享 session 确定每地址的运行候选。
  for (const [old_id, value] of Object.entries(object_value(vault.accounts))) {
    const item = object_value(value);
    const connection = connection_for(item.federation_url);
    if (!connection) continue;
    const account = import_account(connection, item);
    if (account) old_accounts.set(old_id, account);
  }
  for (const [key, value] of Object.entries(object_value(config.sessions))) {
    const item = object_value(value);
    const connection = connection_for(text_value(item.federation_url) || key);
    if (!connection) continue;
    const account = import_account(connection, item);
    if (account) {
      // 共享配置明确保存的设备会话才是该地址的运行候选，不能复用最先导入的旧 Token。
      account.user_token = text_value(item.user_token) || undefined;
      account.session_id = text_value(item.session_id) || undefined;
      select(connection, account);
    }
  }
  const active_id = text_value(vault.active_account_id);
  const active = old_accounts.get(active_id);
  if (active) {
    // 原 Desktop 明确选中账户的凭据优先于同主体的其他历史设备会话。
    const original = object_value(object_value(vault.accounts)[active_id]);
    active.user_token = text_value(original.user_token) || undefined;
    active.session_id = text_value(original.session_id) || undefined;
    select(state.connections[active.connection_id], active);
  }

  settings.set("town.migration.v1.archive", {
    migrated_at: now, downcity_config: config_value, desktop_user_accounts: vault_value,
    // 原记录中的非法/未知字段也保留在档案中，不因无法运行而丢弃。
  });
  settings.set(TOWN_CONNECTION_STATE_KEY, state);
  return state;
}

/** 读取迁移输入的对象，不将任意 primitive 或数组当成账户配置。 */
function object_value(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

/** 既有配置文本只用于迁移，空值保留为未知身份。 */
function text_value(value: unknown): string { return typeof value === "string" ? value.trim() : ""; }
