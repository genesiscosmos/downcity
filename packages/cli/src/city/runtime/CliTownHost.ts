/**
 * CLI Town 宿主：恢复多连接、固定凭据来源、编排身份事务并拥有 SDK 客户端生命周期。
 * 同一实现用于常驻 CLI City 和持有独占 root 租约的离线命令；不启动监听或进程。
 */
import { Town, TownError, create_downtown_id, type TownOptions, type TownAuthAdapter, type TownRegistration } from "@downcity/city";
import { ResourceError, UserSessionRepository, TownImageJobRepository, normalize_town_url, TownServiceDispatcher, TOWN_SERVICE_CAPABILITIES } from "@downcity/city/local";
import { Downtown, type UserSessionCredentials } from "@downcity/downtown";
import type { CliLocalData } from "./LocalData.js";

/** 本机管理通道明确允许的 Town 操作。 */
export const CLI_TOWN_CAPABILITIES = [
  "town.connection.list", "town.connection.get", "town.connection.add", "town.connection.rename",
  "town.connection.remove", "town.connection.restore", "town.connection.accounts", "town.connection.login", "town.connection.logout",
  "town.connection.whoami", "town.models", "town.services", ...TOWN_SERVICE_CAPABILITIES,
] as const;

/** 成对环境来源不读取其他连接凭据，不覆盖持久连接。 */
export function read_cli_town_environment(): { /** 临时 endpoint。 */ url: string; /** 临时凭据，仅进程内使用。 */ user_token: string } | undefined {
  const url = process.env.DOWNCITY_DOWNTOWN_URL?.trim();
  const user_token = process.env.DOWNCITY_USER_TOKEN?.trim();
  if (Boolean(url) !== Boolean(user_token)) throw new ResourceError("validation_error", "DOWNCITY_DOWNTOWN_URL and DOWNCITY_USER_TOKEN must be provided together", 2);
  return url && user_token ? { url: normalize_town_url(url), user_token } : undefined;
}

/** Town 选项先于 City 构造，attach 之后才允许管理操作。 */
export class CliTownHost {
  readonly options: TownOptions;
  private town?: Town;
  /** 实际响应 reader 归当前 owner，不随单次管理请求结束释放。 */
  private service_bridge?: TownServiceDispatcher;
  private readonly clients = new Map<string, Downtown>();
  private readonly owned = new Set<Downtown>();
  private readonly sessions: UserSessionRepository;
  private readonly changes = new Set<string>();
  /** 历史任务查询客户端按精确授权来源缓存，不影响当前身份。 */
  private readonly image_clients = new Map<string, Downtown>();

  constructor(private readonly data: Pick<CliLocalData, "database" | "town_connections">) {
    // 仅从持有 root 写租约的组合入口构造；通用配置读取不得触发连接迁移。
    data.town_connections.migrate();
    this.sessions = new UserSessionRepository(data.database);
    const environment = read_cli_town_environment();
    const connections: Record<string, TownRegistration> = {};
    for (const connection of data.town_connections.list()) {
      const credentials = data.town_connections.credentials(connection.downtown_id);
      // 未核验迁移主体不得凭 Token 猜测执行身份；历史仍保留，明确重新登录。
      const verified = credentials?.auth_scope_id && credentials.user_id ? credentials : undefined;
      const client = this.create_client(connection.url, verified?.user_token, verified?.session_id);
      this.clients.set(connection.downtown_id, client);
      connections[connection.downtown_id] = { client, name: connection.name,
        auth_scope_id: verified?.auth_scope_id ?? `guest:${connection.downtown_id}`, durable: Boolean(verified) };
    }
    if (environment) {
      const downtown_id = create_downtown_id(environment.url);
      if (connections[downtown_id]) throw new ResourceError("dependency_conflict", "Environment Downtown address is already registered; use its saved login", 4);
      connections[downtown_id] = { client: this.create_client(environment.url, environment.user_token), name: "Environment (temporary)", durable: false };
    }
    this.options = { connections, auth: this.create_auth_adapter(), image_jobs: new TownImageJobRepository(data.database),
      resolve_image_user: async (origin) => {
        const credentials = data.town_connections.credentials(origin.downtown_id, origin.auth_scope_id);
        if (!credentials || credentials.url !== origin.endpoint_url || credentials.auth_scope_id !== origin.auth_scope_id) throw new ResourceError("dependency_conflict", "Restore the original service identity to query this image", 4);
        const key = `${origin.downtown_id}:${origin.auth_scope_id}`;
        let client = this.image_clients.get(key);
        if (!client) { client = this.create_client(credentials.url, credentials.user_token, credentials.session_id); this.image_clients.set(key, client); }
        return client.user;
      },
    };
  }

  attach(town: Town): void { this.town = town; this.service_bridge = new TownServiceDispatcher(town); }

  /** 只向管理通道返回非秘密资料；密码、Token 和刷新信息从不进入返回值。 */
  async dispatch(method: string, input: Record<string, unknown>): Promise<unknown> {
    if (!(CLI_TOWN_CAPABILITIES as readonly string[]).includes(method)) throw new ResourceError("capability_missing", "Unsupported Town operation", 5);
    try {
      if ((TOWN_SERVICE_CAPABILITIES as readonly string[]).includes(method)) return await this.service_bridge!.dispatch(method, input);
      return await this.dispatch_operation(method, input);
    }
    catch (error) {
      if (error instanceof TownError) throw new ResourceError(error.code, error.code, 4);
      throw error;
    }
  }

  private async dispatch_operation(method: string, input: Record<string, unknown>): Promise<unknown> {
    const town = this.require_town();
    const repository = this.data.town_connections;
    const downtown_id = typeof input.downtown_id === "string" ? input.downtown_id : "";
    if (method === "town.models" || method === "town.services") {
      const result = method === "town.models" ? await town.models.list() : await town.services.list();
      if (!downtown_id) return result;
      town.get(downtown_id);
      return { items: result.items.filter((item) => "source_id" in item ? item.source_id === downtown_id : item.downtown_id === downtown_id),
        sources: result.sources.filter((source) => source.downtown_id === downtown_id) };
    }
    if (method === "town.connection.list") {
      return { items: repository.list({ include_removed: input.include_removed === true }),
        sources: town.list().map(({ user: _user, ...source }) => source) };
    }
    if (method === "town.connection.get") return this.require_connection(downtown_id);
    if (method === "town.connection.accounts") return repository.accounts(downtown_id);
    if (method === "town.connection.whoami") {
      const connection = town.get(downtown_id);
      const current = await connection.user.current();
      return { downtown_id, auth_scope_id: connection.auth_scope_id, user: current.user, profile: current.profile };
    }
    // 同一连接的管理事务串行拒绝，不阻塞其他连接；Town 负责实际请求租约。
    const change_key = method === "town.connection.add" ? `url:${normalize_town_url(String(input.url ?? ""))}` : downtown_id;
    if (this.changes.has(change_key)) throw new ResourceError("resource_busy", "Service connection is being changed", 4);
    this.changes.add(change_key);
    try {
      if (method === "town.connection.add") {
        const url = normalize_town_url(String(input.url ?? ""));
        return this.data.database.transaction(() => {
          const connection = repository.add({ url, name: typeof input.name === "string" ? input.name : undefined });
          if (!town.list().some((item) => item.downtown_id === connection.downtown_id)) this.register(connection.downtown_id);
          return connection;
        });
      }
      const connection = this.require_connection(downtown_id);
      if (input.revision !== undefined && input.revision !== connection.revision) throw new ResourceError("dependency_conflict", "Service connection changed; retry with its latest revision", 4);
      if (method === "town.connection.login") {
        if (input.url !== connection.url) throw new ResourceError("dependency_conflict", "Service endpoint changed during sign in", 4);
        return await town.login(downtown_id, { provider: "cli-exchange", input: { credentials: input.credentials, revision: connection.revision } });
      }
      if (method === "town.connection.logout") { await town.logout(downtown_id); return this.require_connection(downtown_id); }
      if (method === "town.connection.rename") {
        const result = repository.rename(downtown_id, String(input.name ?? ""), connection.revision);
        town.rename(downtown_id, result.name);
        return result;
      }
      if (method === "town.connection.remove") {
        const registration = this.registration(downtown_id);
        if (connection.status === "removed") return connection;
        await town.remove(downtown_id); // Busy 发生在任何持久修改之前。
        try { return repository.remove(downtown_id, connection.revision); }
        catch (error) { town.add(downtown_id, registration.client, registration); throw error; }
      }
      if (method === "town.connection.restore") {
        const result = repository.restore(downtown_id, connection.revision);
        try { this.register(downtown_id); return result; }
        catch (error) { repository.remove(downtown_id, result.revision); throw error; }
      }
      throw new ResourceError("capability_missing", "Unsupported Town operation", 5);
    } finally { this.changes.delete(change_key); }
  }

  /** Town 先释放借用后再释放宿主拥有的客户端。 */
  /** 在 Town.close 之前调用，先结束所有响应租约。 */
  async close_responses(): Promise<void> { await this.service_bridge?.dispose(); }

  async dispose(): Promise<void> {
    await this.close_responses();
    const results = await Promise.allSettled([...this.owned].map((client) => client.dispose()));
    this.owned.clear(); this.clients.clear();
    const errors = results.flatMap((result) => result.status === "rejected" ? [result.reason] : []);
    if (errors.length) throw new AggregateError(errors, "CLI Town client cleanup failed");
  }

  private create_auth_adapter(): TownAuthAdapter {
    return {
      login: async (context, input) => {
        if (input.provider !== "cli-exchange") throw new ResourceError("validation_error", "Use city downtown login for CLI sign in", 2);
        const credentials = require_credentials(input.input?.credentials);
        const connection = this.require_connection(context.connection.downtown_id);
        if (input.input?.revision !== connection.revision || connection.url !== context.connection.endpoint_url) throw new ResourceError("dependency_conflict", "Service connection changed during sign in", 4);
        const client = this.create_client(connection.url, credentials.user_token);
        try {
          const verified = await client.user.current();
          const user_id = verified.user.user_id;
          if (!user_id) throw new ResourceError("validation_error", "Sign-in identity could not be verified", 2);
          const auth_scope_id = this.data.town_connections.prepare_account_scope(connection.downtown_id, user_id, connection.revision);
          const renewable = this.create_client(connection.url, credentials.user_token, credentials.session_id);
          try { await context.commit({ client: renewable, name: connection.name, auth_scope_id, durable: true }, async () => {
            this.data.database.transaction(() => {
              this.sessions.save(connection.url, credentials);
              this.data.town_connections.save_account(connection.downtown_id, { user_id, user_token: credentials.user_token,
                session_id: credentials.session_id, auth_scope_id, display_name: verified.profile?.display_name, email: verified.profile?.email }, connection.revision);
            });
          }); } catch (error) { await renewable.dispose(); this.owned.delete(renewable); throw error; }
          // 保存后客户端续期始终只读取这一个 session，不跟随新选择的账户。
          const previous = this.clients.get(connection.downtown_id);
          this.clients.set(connection.downtown_id, renewable);
          if (previous) { await previous.dispose(); this.owned.delete(previous); }
          await client.dispose(); this.owned.delete(client);
          return { status: "done" };
        } catch (error) { await client.dispose(); this.owned.delete(client); throw error; }
      },
      logout: async (context) => {
        const connection = this.require_connection(context.connection.downtown_id);
        const previous = this.clients.get(connection.downtown_id);
        const credentials = this.data.town_connections.credentials(connection.downtown_id);
        const row = credentials?.session_id ? this.sessions.read(connection.url, credentials.session_id) : null;
        const guest = this.create_client(connection.url);
        // 远端撤销使用原身份的静态快照；已失效的续期 resolver 不得阻止 logout 请求发出。
        const revoker = credentials ? this.create_client(connection.url, row?.user_token || credentials.user_token) : undefined;
        try {
          await context.commit({ client: guest, name: connection.name, auth_scope_id: `guest:${connection.downtown_id}`, durable: true }, async () => {
            this.data.database.transaction(() => {
              if (credentials?.session_id) this.sessions.invalidate(connection.url, credentials.session_id);
              this.data.town_connections.logout(connection.downtown_id, connection.revision);
            });
          });
        } catch (error) {
          await guest.dispose(); this.owned.delete(guest);
          if (revoker) { await revoker.dispose(); this.owned.delete(revoker); }
          throw error;
        }
        this.clients.set(connection.downtown_id, guest);
        if (revoker) {
          try { await revoker.user.account.logout(row?.refresh_token); } catch { /* 本地退出已经提交，远端不可用不会恢复凭据。 */ }
          finally { await revoker.dispose(); this.owned.delete(revoker); }
        }
        if (previous) { await previous.dispose(); this.owned.delete(previous); }
      },
    };
  }

  private create_client(url: string, user_token?: string, session_id?: string): Downtown {
    const client = new Downtown({ url, user_token, resolve_user_token: session_id ? (fetcher) => this.sessions.token(url, session_id, fetcher) : undefined });
    this.owned.add(client);
    return client;
  }

  private registration(downtown_id: string): TownRegistration {
    const connection = this.require_connection(downtown_id);
    const credentials = this.data.town_connections.credentials(downtown_id);
    const verified = credentials?.auth_scope_id && credentials.user_id ? credentials : undefined;
    const client = this.clients.get(downtown_id) ?? this.create_client(connection.url, verified?.user_token, verified?.session_id);
    return { client, name: connection.name, auth_scope_id: verified?.auth_scope_id ?? `guest:${downtown_id}`, durable: true };
  }

  private register(downtown_id: string): void {
    const registration = this.registration(downtown_id);
    this.require_town().add(downtown_id, registration.client, registration);
    this.clients.set(downtown_id, registration.client);
  }

  private require_connection(downtown_id: string) {
    const connection = this.data.town_connections.get(downtown_id);
    if (!connection) throw new ResourceError("resource_not_found", "Service connection not found", 3);
    return connection;
  }

  private require_town(): Town {
    if (!this.town) throw new ResourceError("host_offline", "Town host is not attached", 5);
    return this.town;
  }
}

/** 管理通道输入必须包含完整可续期凭据，具体协议与主体由远端和仓储再次校验。 */
function require_credentials(value: unknown): UserSessionCredentials {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new ResourceError("validation_error", "Login exchange is required", 2);
  const fields = ["user_token", "session_id", "refresh_token", "expires_at", "refresh_expires_at"];
  if (fields.some((field) => typeof (value as Record<string, unknown>)[field] !== "string" || !(value as Record<string, unknown>)[field])) throw new ResourceError("validation_error", "Login exchange did not return renewable credentials", 2);
  return value as UserSessionCredentials;
}
