/**
 * AIService 中转装配层。
 * Key 管理必须经过登录授权；调用授权由 Federation 路由仅在语言模型入口
 * 显式调用，不能升级为普通 user。目录管理、日志查询和执行共用 AIService
 * 的数据库，与既有结算任务通过稳定 request_id 关联。
 */
import type { CityModelDescriptor } from "@downcity/type";
import { query_service_database, settlement_credits_sql } from "../ai/database-sql.js";
import type { Service, Context } from "../service.js";
import type { ServiceDatabaseContext } from "../../types/database/Database.js";
import type { CityTableApi } from "../../store/table-api.js";
import type { AIModelDefinition } from "../../types/AI.js";
import type {
  RelayInitialization, RelayPrincipal, RelayRequestLog, RelayRequestPage, RelayAttemptRecord, RelayAttemptList, RelayHealthRecord, RelayCatalogRecord,
} from "../../types/Relay.js";
import { httpError } from "../../utils/helpers.js";
import { RelayCatalogStore } from "./catalog.js";
import { RelayKeyStore } from "./keys.js";
import { RelayRouter } from "./router.js";
import { pg_relay_index_ddl } from "./schema.pg.js";
import type { RelayAdminMetadata, RelayAdminHealth } from "../../types/RelayAdmin.js";

/** 可选中转功能，生命周期由 AIService 管理。 */
export class RelayRuntime {
  private dependencies?: RelayInitialization;
  private catalog_store?: RelayCatalogStore;
  private key_store?: RelayKeyStore;
  private router?: RelayRouter;

  constructor(service: Service) {
    service.action("keys/create", async (ctx) => {
      return await this.keys().create(this.user_id(ctx), ctx.input);
    }, { auth: ["user"] });
    service.action("keys/list", async (ctx) => await this.keys().list(this.user_id(ctx)), {
      method: "GET", auth: ["user"],
    });
    service.action("keys/update", async (ctx) => await this.keys().update(this.user_id(ctx), ctx.input), {
      auth: ["user"],
    });
    service.action("keys/revoke", async (ctx) => await this.keys().update(this.user_id(ctx), {
      key_id: ctx.input.key_id, status: "revoked",
    }), { auth: ["user"] });
    service.action("relay/catalog", async () => structuredClone(await this.catalog().read(true)), {
      method: "GET", auth: ["admin"],
    });
    service.action("relay/metadata", (): RelayAdminMetadata => ({
      adapters: ["registered", "openai_chat_completions"],
      templates: this.dependencies!.models.filter((model) => model.runtime.stream).map((model) => ({
        id: model.id, name: model.name, channel_id: model.channel_id, upstream_model: model.upstream_model,
      })),
    }), { method: "GET", auth: ["admin"] });
    service.action("relay/health", async (): Promise<RelayAdminHealth> => {
      const { catalog } = await this.catalog().read();
      const checked_at = Date.now();
      const rows = await query_service_database<RelayHealthRecord>(this.dependencies!.database, {
        sql: "SELECT deployment_id, cooldown_until FROM service_ai_relay_health", params: [],
      });
      const cooldowns = new Map(rows.rows.map((row) => [row.deployment_id, row.cooldown_until]));
      return { checked_at, items: catalog.deployments.map((deployment) => ({
        deployment_id: deployment.id, channel_id: deployment.channel_id,
        enabled: deployment.enabled && catalog.models.some((model) => model.id === deployment.model_id && model.enabled) &&
          catalog.channels.some((channel) => channel.id === deployment.channel_id && channel.enabled),
        cooldown_until: cooldowns.get(deployment.id) ?? null,
        cooling: (cooldowns.get(deployment.id) ?? 0) > checked_at,
      })) };
    }, { method: "GET", auth: ["admin"] });
    service.action("relay/configure", async (ctx) => await this.catalog().replace(ctx.input.catalog, ctx.input.revision), {
      auth: ["admin"],
    });
    service.action("relay/requests", async (ctx) => await this.list_requests(ctx, this.user_id(ctx)), {
      method: "GET", auth: ["user"],
    });
    service.action("relay/admin/requests", async (ctx) => await this.list_requests(ctx), {
      method: "GET", auth: ["admin"],
    });
    service.action("relay/attempts", async (ctx) => await this.list_attempts(ctx, this.user_id(ctx)), {
      method: "GET", auth: ["user"],
    });
    service.action("relay/admin/attempts", async (ctx) => await this.list_attempts(ctx), {
      method: "GET", auth: ["admin"],
    });
  }

  /** 部署时创建索引并写入默认目录；所有资源显式注入，不依赖 initialize。 */
  async prepare_database(
    database: ServiceDatabaseContext,
    catalog_table: CityTableApi<RelayCatalogRecord>,
    models: AIModelDefinition[],
  ): Promise<void> {
    if (database.schema_id === "postgresql") {
      for (const sql of pg_relay_index_ddl) {
        await query_service_database(database, { sql, params: [] });
      }
    }
    await new RelayCatalogStore(catalog_table, models).prepare_database();
  }

  /** 绑定运行时存储并加载目录，不执行结构 DDL。 */
  async initialize(dependencies: RelayInitialization): Promise<void> {
    this.dependencies = dependencies;
    this.catalog_store = new RelayCatalogStore(dependencies.table("relay_catalog"), dependencies.models);
    this.key_store = new RelayKeyStore(dependencies.table("relay_keys"), dependencies.database);
    this.router = new RelayRouter(dependencies);
    await this.catalog_store.initialize();
  }

  /** 不赋予登录权限，只将计费用户和最小凭据主体附加到请求。 */
  async authorize(token: string, ctx: Context): Promise<void> {
    const model = ctx.action?.id === "models" ? undefined
      : ctx.action?.id === "stream" ? ctx.input.model_id : ctx.input.model;
    if (ctx.action?.id !== "models" && (typeof model !== "string" || !model.trim())) {
      throw httpError(422, "model is required");
    }
    const principal = await this.keys().authorize(token, typeof model === "string" ? model.trim() : undefined);
    ctx.locals.relay_principal = principal;
    ctx.user = { user_id: principal.user_id };
    // identity 保持 guest，通用 hook 可明确区分登录用户和受限调用主体。
  }

  /** Key 消费软上限检查；由 AIService 与 Credits precheck 并行执行。 */
  async precheck(ctx: Context): Promise<void> {
    const principal = ctx.locals.relay_principal as RelayPrincipal | undefined;
    if (principal) await this.keys().check_spend(principal);
  }

  async resolve(ctx: Context, model_id: string): Promise<AIModelDefinition> {
    if (!this.router) throw new Error("Relay runtime is not initialized");
    const { catalog, revision } = await this.catalog().read();
    ctx.locals.relay_catalog_revision = revision;
    return this.router.resolve(ctx, model_id, catalog);
  }

  /** Models 只列出当前主体获准且至少有一个可配置部署的入口。 */
  async list_models(ctx: Context, descriptors: CityModelDescriptor[]): Promise<CityModelDescriptor[]> {
    const { catalog } = await this.catalog().read();
    const principal = ctx.locals.relay_principal as RelayPrincipal | undefined;
    const descriptor_map = new Map(descriptors.map((item) => [item.id, item]));
    const result: CityModelDescriptor[] = [];
    const entries = [
      ...catalog.models.map((model) => ({ id: model.id, model_id: model.id, enabled: model.enabled, deployment_ids: undefined })),
      ...catalog.routes,
    ];
    for (const entry of entries) {
      if (!entry.enabled || (principal && !principal.allowed_models.includes("*") && !principal.allowed_models.includes(entry.id))) continue;
      const model = catalog.models.find((item) => item.id === entry.model_id && item.enabled);
      const descriptor = model ? descriptor_map.get(model.template_model_id) : undefined;
      if (!descriptor) continue;
      const available = catalog.deployments.some((deployment) => {
        if (!deployment.enabled || deployment.model_id !== model!.id) return false;
        if (entry.deployment_ids && !entry.deployment_ids.includes(deployment.id)) return false;
        const channel = catalog.channels.find((item) => item.id === deployment.channel_id && item.enabled);
        if (!channel) return false;
        if (channel.adapter === "openai_chat_completions") return Boolean(ctx.env(channel.credential_env!));
        const runtime = this.dependencies!.models.find((item) => item.id === deployment.runtime_model_id);
        return Boolean(runtime && Object.keys(runtime.env ?? {}).every((key) => ctx.env(key)));
      });
      if (available) result.push({ ...descriptor, id: entry.id, modalities: ["stream"] });
    }
    return result;
  }

  private async list_requests(ctx: Context, user_id?: string): Promise<RelayRequestPage> {
    const limit = ctx.input.limit === undefined ? 50 : Number(ctx.input.limit);
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw httpError(422, "limit must be between 1 and 100");
    const before = typeof ctx.input.before === "string" ? ctx.input.before : "";
    const filters: string[] = [];
    const params: unknown[] = [];
    if (user_id) { filters.push("r.user_id = ?"); params.push(user_id); }
    if (before) {
      filters.push(`(r.started_at, r.request_id) < (SELECT started_at, request_id FROM service_ai_relay_requests WHERE request_id = ?)`);
      params.push(before);
    }
    if (typeof ctx.input.key_id === "string") { filters.push("r.key_id = ?"); params.push(ctx.input.key_id); }
    params.push(limit);
    const result = await query_service_database<RelayRequestLog>(this.dependencies!.database, {
      sql: `SELECT r.*, s.status AS settlement_status, u.metering_status,
        u.uncached_input_tokens, u.cached_input_tokens, u.output_tokens, u.reasoning_tokens, u.duration_ms,
        u.channel_id, u.upstream_model,
        CASE WHEN s.status = 'completed' THEN ${settlement_credits_sql(this.dependencies!.database.schema_id)} ELSE NULL END AS charged_credits
        FROM service_ai_relay_requests r
        LEFT JOIN service_ai_settlement_jobs s ON s.usage_id = r.request_id
        LEFT JOIN service_ai_usage_records u ON u.usage_id = r.request_id
        ${filters.length ? `WHERE ${filters.join(" AND ")}` : ""}
        ORDER BY r.started_at DESC, r.request_id DESC LIMIT ?`,
      params,
    });
    return { items: result.rows };
  }

  private async list_attempts(ctx: Context, user_id?: string): Promise<RelayAttemptList> {
    const request_id = typeof ctx.input.request_id === "string" ? ctx.input.request_id : "";
    const result = await query_service_database<RelayAttemptRecord>(this.dependencies!.database, {
      sql: `SELECT a.* FROM service_ai_relay_attempts a
        JOIN service_ai_relay_requests r ON a.request_id = r.request_id
        WHERE r.request_id = ? ${user_id ? "AND r.user_id = ?" : ""} ORDER BY a.started_at, a.attempt_id`,
      params: user_id ? [request_id, user_id] : [request_id],
    });
    return { items: result.rows };
  }

  private user_id(ctx: Context): string {
    if (!ctx.user?.user_id || ctx.identity?.kind !== "user") throw httpError(401, "User login required");
    return ctx.user.user_id;
  }

  private keys(): RelayKeyStore {
    if (!this.key_store) throw new Error("Relay keys are not initialized");
    return this.key_store;
  }

  private catalog(): RelayCatalogStore {
    if (!this.catalog_store) throw new Error("Relay catalog is not initialized");
    return this.catalog_store;
  }
}
