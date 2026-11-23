/** 一次性转换既有 Town 登记：地址派生身份，账户与凭据原样保留，事务失败不落盘。 */
import type { LegacyTownConnectionState, TownConnectionState, TownMigrationSettings } from "../types/TownConnection.js";
import { create_downtown_id, normalize_downtown_url } from "../../town/DowntownId.js";

/** 只在旧版存储存在且新版缺失时运行；不解析旧模型选择，也不推断授权。 */
export function migrate_registered_downtowns(settings: TownMigrationSettings, previous: unknown): TownConnectionState {
  const old = previous as LegacyTownConnectionState;
  if (old.version !== 1 || !old.connections || !old.accounts) throw new Error("Unsupported Town registration storage");
  const state: TownConnectionState = { version: 2, connections: {}, accounts: {} };
  const identities = new Map<string, string>();
  // 同地址历史重复登记汇入一个来源；优先保留有效且最近修改的明确选择。
  const connections = Object.entries(old.connections).sort(([, first], [, second]) =>
    Number(first.status === "active") - Number(second.status === "active") || first.updated_at.localeCompare(second.updated_at));
  for (const [previous_id, value] of connections) {
    const { connection_id: _legacy_id, ...entry } = value;
    const url = normalize_downtown_url(entry.url);
    const downtown_id = entry.source === "extension" ? previous_id : create_downtown_id(url);
    identities.set(previous_id, downtown_id);
    state.connections[downtown_id] = { ...entry, downtown_id, url };
  }
  for (const [account_id, value] of Object.entries(old.accounts)) {
    const { connection_id, ...entry } = value;
    const downtown_id = identities.get(connection_id ?? entry.downtown_id ?? "");
    if (!downtown_id) throw new Error("Town account has no registered Downtown");
    state.accounts[account_id] = { ...entry, downtown_id, url: normalize_downtown_url(entry.url) };
  }
  settings.set("town.registration.v1.archive", previous);
  settings.set("town.connections.v2", state);
  return state;
}
