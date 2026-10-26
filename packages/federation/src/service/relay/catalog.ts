/**
 * 中转目录校验与缓存。
 * 目录以单行版本化 JSON 原子替换，调用侧共享并发加载 Promise，缓存五秒。
 * 更新使用 revision 乐观锁，其他实例最迟在缓存到期后读取新配置；Key 撤销
 * 不使用此缓存。启动仅在配置不存在时导入已注册语言模型。
 */
import { z } from "zod";
import type { AIModelDefinition } from "../../types/AI.js";
import type { RelayCatalog, RelayCatalogRecord, RelayCatalogCache, RelayCatalogSnapshot, RelayCatalogUpdated } from "../../types/Relay.js";
import type { CityTableApi } from "../../store/table-api.js";
import { httpError } from "../../utils/helpers.js";

const id_schema = z.string().trim().min(1).max(160).regex(/^[A-Za-z0-9][A-Za-z0-9._:/-]*$/);
const catalog_schema = z.object({
  models: z.array(z.object({
    id: id_schema, template_model_id: id_schema, enabled: z.boolean(),
  }).strict()).max(1000),
  channels: z.array(z.object({
    id: id_schema,
    adapter: z.enum(["registered", "openai_chat_completions"]),
    enabled: z.boolean(),
    base_url: z.string().url().max(2048).optional(),
    credential_env: z.string().regex(/^[A-Z][A-Z0-9_]*$/).max(160).optional(),
    timeout_ms: z.number().int().min(1000).max(300000).optional(),
  }).strict()).max(500),
  deployments: z.array(z.object({
    id: id_schema, model_id: id_schema, channel_id: id_schema,
    upstream_model: z.string().trim().min(1).max(256),
    runtime_model_id: id_schema.optional(), enabled: z.boolean(),
    priority: z.number().int().min(-1000).max(1000), weight: z.number().int().min(1).max(10000),
  }).strict()).max(5000),
  routes: z.array(z.object({
    id: id_schema, model_id: id_schema, deployment_ids: z.array(id_schema).min(1).max(100),
    strategy: z.literal("priority_weighted"), max_attempts: z.number().int().min(1).max(3), enabled: z.boolean(),
  }).strict()).max(1000),
}).strict();

/** 校验引用关系，避免配置成功后才在热路径发现错误。 */
export function validate_relay_catalog(input: unknown, models: AIModelDefinition[]): RelayCatalog {
  const parsed = catalog_schema.safeParse(input);
  if (!parsed.success) throw httpError(422, "Invalid relay catalog");
  const catalog = parsed.data;
  const registered = new Map(models.map((model) => [model.id, model]));
  for (const items of [catalog.models, catalog.channels, catalog.deployments, catalog.routes]) {
    if (new Set(items.map((item) => item.id)).size !== items.length) throw httpError(422, "Duplicate relay ID");
  }
  for (const model of catalog.models) {
    if (!registered.get(model.template_model_id)?.runtime.stream) throw httpError(422, "Invalid model template");
  }
  for (const channel of catalog.channels) {
    if (channel.adapter === "openai_chat_completions") {
      if (!channel.base_url || !channel.credential_env) throw httpError(422, "Channel requires base_url and credential_env");
      const url = new URL(channel.base_url);
      if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) {
        throw httpError(422, "Channel requires a credential-free HTTPS base_url");
      }
    } else if (!models.some((model) => model.runtime.stream && model.channel_id === channel.id)) {
      throw httpError(422, "Registered channel must reference an installed adapter channel");
    } else if (channel.base_url || channel.credential_env) {
      throw httpError(422, "Registered channels use their SDK adapter configuration");
    }
  }
  for (const deployment of catalog.deployments) {
    const model = catalog.models.find((item) => item.id === deployment.model_id);
    const channel = catalog.channels.find((item) => item.id === deployment.channel_id);
    if (!model || !channel) throw httpError(422, "Invalid deployment reference");
    if (channel.adapter === "registered") {
      const runtime = registered.get(deployment.runtime_model_id ?? "");
      if (!runtime?.runtime.stream || runtime.id !== model.template_model_id ||
        runtime.channel_id !== channel.id || runtime.upstream_model !== deployment.upstream_model) {
        throw httpError(422, "Registered deployment must match its template and channel");
      }
    } else if (deployment.runtime_model_id) {
      throw httpError(422, "OpenAI deployments do not use runtime_model_id");
    }
  }
  for (const route of catalog.routes) {
    if (catalog.models.some((item) => item.id === route.id) ||
      !catalog.models.some((item) => item.id === route.model_id) ||
      new Set(route.deployment_ids).size !== route.deployment_ids.length ||
      route.deployment_ids.some((id) => !catalog.deployments.some((item) => item.id === id && item.model_id === route.model_id))) {
      throw httpError(422, "Invalid route reference");
    }
  }
  return catalog;
}

/** 从当前 SDK 注册表生成首次启动的可运营目录。 */
function seed_catalog(models: AIModelDefinition[]): RelayCatalog {
  const language_models = models.filter((model) => model.runtime.stream);
  return {
    models: language_models.map((model) => ({ id: model.id, template_model_id: model.id, enabled: true })),
    channels: [...new Set(language_models.map((model) => model.channel_id))]
      .map((id) => ({ id, adapter: "registered", enabled: true })),
    deployments: language_models.map((model) => ({
      id: `registered:${model.id}`, model_id: model.id, channel_id: model.channel_id,
      upstream_model: model.upstream_model, runtime_model_id: model.id,
      enabled: true, priority: 0, weight: 1,
    })),
    routes: [],
  };
}

/** 实例内配置缓存，数据库始终是配置事实源。 */
export class RelayCatalogStore {
  private cached?: RelayCatalogCache;
  private loading?: Promise<RelayCatalogSnapshot>;

  constructor(
    private readonly table: CityTableApi<RelayCatalogRecord>,
    private readonly models: AIModelDefinition[],
  ) {}

  async initialize(): Promise<void> {
    const catalog = validate_relay_catalog(seed_catalog(this.models), this.models);
    await this.table.insert_if_absent({ id: "catalog", revision: 1, catalog_json: JSON.stringify(catalog) });
    await this.read();
  }

  /** 合并同一实例内的并发缓存未命中；不将可变目录直接交给外部调用方。 */
  async read(fresh = false): Promise<RelayCatalogSnapshot> {
    if (fresh) {
      await this.loading;
      this.cached = undefined;
    }
    if (this.cached && this.cached.expires_at > Date.now()) {
      return { catalog: this.cached.catalog, revision: this.cached.revision };
    }
    if (!this.loading) {
      this.loading = this.load().finally(() => { this.loading = undefined; });
    }
    return await this.loading;
  }

  async replace(input: unknown, revision: unknown): Promise<RelayCatalogUpdated> {
    if (!Number.isSafeInteger(revision) || Number(revision) < 1) throw httpError(422, "revision is required");
    const catalog = validate_relay_catalog(input, this.models);
    const changed = await this.table.update({
      where: { id: "catalog", revision: Number(revision) },
      values: { revision: Number(revision) + 1, catalog_json: JSON.stringify(catalog) },
    });
    if (!changed) throw httpError(409, "Relay configuration changed; reload before saving");
    // 等待旧的读取结束后失效，避免旧 Promise 回写覆盖新配置。
    await this.loading;
    this.cached = undefined;
    return { revision: Number(revision) + 1 };
  }

  private async load(): Promise<RelayCatalogSnapshot> {
    const row = (await this.table.select({ id: "catalog" }))[0];
    if (!row) throw new Error("Relay catalog is not initialized");
    this.cached = {
      catalog: validate_relay_catalog(JSON.parse(row.catalog_json), this.models),
      revision: row.revision, expires_at: Date.now() + 5000,
    };
    return { catalog: this.cached.catalog, revision: this.cached.revision };
  }
}
