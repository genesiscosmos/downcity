/**
 * Desktop 与 CLI 共用的 Town 连接事实源。
 * 仓储只管理持久化和 CAS；登录核验、执行门禁、远端退出、客户端释放由宿主完成。
 * 公开资料不包含凭据，历史 scope 只允许宿主查询原任务时显式读取。
 */
import { randomUUID } from "node:crypto";
import type { LocalDatabase } from "../database/LocalDatabase.js";
import { create_downtown_id } from "../../town/DowntownId.js";
import { LocalSettingRepository } from "./LocalSettingRepository.js";
import { migrate_town_connections, normalize_town_url, TOWN_CONNECTION_STATE_KEY } from "../runtime/TownConnectionMigration.js";
import type { StoredTownAccount, TownAccount, TownAccountInput, TownConnection, TownConnectionInput, TownConnectionListOptions, TownConnectionState, TownCredentials } from "../types/TownConnection.js";

/** 连接已被其他宿主修改；调用者应重新读取，不能覆盖新身份。 */
export class TownConnectionConflictError extends Error {
  readonly code = "town_connection_conflict";
  constructor() { super("Service connection changed; reload it before retrying"); }
}

/** 在宿主数据库事务中维护版本化连接、独立身份及历史授权来源。 */
export class TownConnectionRepository {
  private readonly settings: LocalSettingRepository;

  constructor(private readonly database: LocalDatabase) {
    this.settings = new LocalSettingRepository(database);
  }

  /** 幂等迁移旧配置；必须在恢复 Town 连接前完成。 */
  migrate(): void { this.database.transaction(() => migrate_town_connections(this.settings)); }

  /** 默认仅列可恢复连接，已移除条目可供用户明确恢复历史。 */
  list(options: TownConnectionListOptions = {}): TownConnection[] {
    return Object.values(this.read_state().connections).filter((entry) => options.include_removed || entry.status === "active");
  }

  /** 读取非秘密连接资料；未知 ID 返回 null，不隐式按名称或 URL 查找。 */
  get(downtown_id: string): TownConnection | null { return this.read_state().connections[downtown_id] ?? null; }

  /** 地址规范化用于去重；不把已移除来源悄悄作为新连接恢复。 */
  add(input: TownConnectionInput): TownConnection {
    const url = normalize_town_url(input.url);
    return this.mutate((state) => {
      const previous = Object.values(state.connections).find((entry) => entry.url === url && entry.status === "active");
      if (previous) return previous;
      const downtown_id = create_downtown_id(url);
      if (state.connections[downtown_id]) throw new Error("Restore the existing Downtown before using this address");
      const now = new Date().toISOString();
      const connection: TownConnection = {
        downtown_id: create_downtown_id(url), name: input.name?.trim() || url, url, status: "active", source: "remote",
        revision: 1, created_at: now, updated_at: now,
      };
      state.connections[connection.downtown_id] = connection;
      return connection;
    });
  }

  /** 只改变展示名称；宿主无须替换执行客户端或使身份绑定失效。 */
  rename(downtown_id: string, name: string, expected_revision?: number): TownConnection {
    const next_name = require_text(name, "Connection name");
    return this.update(downtown_id, expected_revision, (connection) => { connection.name = next_name; });
  }

  /** 停用来源、保留全部资料；宿主须先通过运行时门禁再调用。 */
  remove(downtown_id: string, expected_revision?: number): TownConnection {
    return this.update(downtown_id, expected_revision, (connection) => { connection.status = "removed"; });
  }

  /** 明确恢复原 ID，使历史模型与任务引用能再次解析。 */
  restore(downtown_id: string, expected_revision?: number): TownConnection {
    return this.update(downtown_id, expected_revision, (connection, state) => {
      if (Object.values(state.connections).some((other) => other.downtown_id !== downtown_id && other.status === "active" && other.url === connection.url)) {
        throw new Error("Another active service connection already uses this address");
      }
      connection.status = "active";
    });
  }

  /** 不返回 Token；旧地址账户仍可展示，但不能在新 endpoint 选中使用。 */
  accounts(downtown_id: string): TownAccount[] {
    const state = this.read_state();
    const connection = this.require_connection(state, downtown_id);
    return Object.values(state.accounts).filter((entry) => entry.downtown_id === downtown_id)
      .map(({ user_token: _user_token, ...entry }) => ({ ...entry, selected: entry.account_id === connection.account_id }));
  }

  /** 为已核验主体准备来源，不写入凭据；宿主随后在 Town 门禁内携带此值提交。 */
  prepare_account_scope(downtown_id: string, user_id_input: string, expected_revision?: number): string {
    const user_id = require_text(user_id_input, "Verified user ID");
    return this.database.transaction(() => {
      const state = migrate_town_connections(this.settings);
      const connection = this.require_connection(state, downtown_id);
      this.require_active(connection);
      if (expected_revision !== undefined && connection.revision !== expected_revision) throw new TownConnectionConflictError();
      const previous = Object.values(state.accounts).find((account) => account.downtown_id === downtown_id
        && account.url === connection.url && account.user_id === user_id);
      return previous?.auth_scope_id ?? randomUUID();
    });
  }

  /** 仅接受远端 current() 核验后的资料；会话刷新信息另由 UserSessionRepository 保存。 */
  save_account(downtown_id: string, input: TownAccountInput, expected_revision?: number): TownConnection {
    const user_id = require_text(input.user_id, "Verified user ID");
    const user_token = require_text(input.user_token, "User token");
    return this.update(downtown_id, expected_revision, (connection, state) => {
      this.require_active(connection);
      const previous = Object.values(state.accounts).find((account) => account.downtown_id === downtown_id
        && account.url === connection.url && account.user_id === user_id);
      const prepared_scope = input.auth_scope_id === undefined ? undefined : require_text(input.auth_scope_id, "Authorization scope");
      if (previous?.auth_scope_id && prepared_scope && previous.auth_scope_id !== prepared_scope) throw new TownConnectionConflictError();
      const auth_scope_id = previous?.auth_scope_id ?? prepared_scope ?? randomUUID();
      if (Object.values(state.accounts).some((account) => account.account_id !== previous?.account_id && account.auth_scope_id === auth_scope_id)) {
        throw new Error("Authorization scope already belongs to another account");
      }
      const account: StoredTownAccount = {
        account_id: previous?.account_id ?? randomUUID(), downtown_id, url: connection.url, user_id, user_token,
        auth_scope_id, session_id: input.session_id,
        display_name: input.display_name, email: input.email, avatar_url: input.avatar_url, last_used_at: Date.now(),
      };
      state.accounts[account.account_id] = account;
      connection.account_id = account.account_id;
      connection.auth_scope_id = account.auth_scope_id;
    });
  }

  /** 选择原 endpoint 的已存身份；宿主负责先核验有效性及目标连接空闲状态。 */
  select_account(downtown_id: string, account_id: string, expected_revision?: number): TownConnection {
    return this.update(downtown_id, expected_revision, (connection, state) => {
      this.require_active(connection);
      const account = state.accounts[account_id];
      if (!account || account.downtown_id !== downtown_id || account.url !== connection.url) {
        throw new Error("Account does not belong to this service endpoint");
      }
      if (!account.user_token && !account.session_id) throw new Error("Account requires sign in");
      account.last_used_at = Date.now();
      connection.account_id = account.account_id;
      connection.auth_scope_id = account.auth_scope_id;
    });
  }

  /** 仅宿主可读取；历史 scope 只能用于原任务查询，不能作为新计费默认身份。 */
  credentials(downtown_id: string, auth_scope_id?: string): TownCredentials | null {
    const state = this.read_state();
    const connection = this.require_connection(state, downtown_id);
    if (connection.status !== "active") return null;
    const account = auth_scope_id
      ? Object.values(state.accounts).find((entry) => entry.downtown_id === downtown_id && entry.auth_scope_id === auth_scope_id && entry.url === connection.url)
      : state.accounts[connection.account_id ?? ""];
    if (!account || account.url !== connection.url || (!account.user_token && !account.session_id)) return null;
    return {
      downtown_id, account_id: account.account_id, auth_scope_id: account.auth_scope_id,
      url: account.url, user_id: account.user_id, user_token: account.user_token ?? "", session_id: account.session_id,
    };
  }

  /** 清除当前账户的本地可用凭据，不删除资料、不激活其他账户。 */
  logout(downtown_id: string, expected_revision?: number): TownConnection {
    return this.update(downtown_id, expected_revision, (connection, state) => {
      const account = state.accounts[connection.account_id ?? ""];
      if (account) { account.user_token = undefined; account.session_id = undefined; }
      connection.account_id = undefined;
      connection.auth_scope_id = undefined;
    });
  }

  /** 在同一事务内读取最新状态、检查 CAS、提交修改；异常自动回滚。 */
  private update(downtown_id: string, expected_revision: number | undefined, apply: (connection: TownConnection, state: TownConnectionState) => void): TownConnection {
    return this.mutate((state) => {
      const connection = this.require_connection(state, downtown_id);
      if (expected_revision !== undefined && connection.revision !== expected_revision) throw new TownConnectionConflictError();
      apply(connection, state);
      connection.revision += 1;
      connection.updated_at = new Date().toISOString();
      return connection;
    });
  }

  private mutate<T>(apply: (state: TownConnectionState) => T): T {
    return this.database.transaction(() => {
      const state = migrate_town_connections(this.settings);
      const result = apply(state);
      this.settings.set(TOWN_CONNECTION_STATE_KEY, state);
      return structuredClone(result);
    });
  }

  private read_state(): TownConnectionState {
    return this.database.transaction(() => migrate_town_connections(this.settings));
  }

  private require_connection(state: TownConnectionState, downtown_id: string): TownConnection {
    const connection = Object.hasOwn(state.connections, downtown_id) ? state.connections[downtown_id] : undefined;
    if (!connection) throw new Error("Service connection not found");
    return connection;
  }

  private require_active(connection: TownConnection): void {
    if (connection.status !== "active") throw new Error("Restore the service connection before signing in");
  }
}

/** 凭据与主体校验只返回明确状态，错误消息不得回显输入内容。 */
function require_text(value: string, label: string): string {
  if (typeof value !== "string" || !value.trim()) throw new TypeError(`${label} is required`);
  return value.trim();
}
