/**
 * LocalCityStore Plugin 装配器。
 *
 * 内建 Plugin 和第三方安装 Plugin 都通过统一的 constructor + manifest 协议恢复。
 * 本模块不负责修改绑定或安装记录，只消费 LocalCityStore 的数据库数据。
 */

import path from "node:path";
import { pathToFileURL } from "node:url";
import fs from "fs-extra";
import { Ajv2020 } from "ajv/dist/2020.js";
import formats_plugin from "ajv-formats";
import type { AgentPluginDefinition, JsonObject, Plugin } from "@downcity/agent";
import {
  ChatPlugin,
  CHAT_PLUGIN_CONFIG_JSON_SCHEMA,
  CHAT_PLUGIN_RESOURCE_JSON_SCHEMA,
  parse_chat_plugin_config,
  parse_chat_plugin_resource,
  resolve_chat_plugin_resource,
  type ChatPluginResource,
  TelegramChannel,
  FeishuChannel,
  QqChannel,
} from "@downcity/plugins/chat";
import { ContactPlugin } from "@downcity/plugins/contact";
import {
  ImagePlugin,
  type ImagePluginModel,
  type ImagePluginResolvedInput,
} from "@downcity/plugins/image";
import {
  BuiltinMemoryProvider,
  FileMemoryStorageAdapter,
  MemoryPlugin,
  get_default_file_memory_root_path,
} from "@downcity/plugins/memory";
import { SkillPlugin } from "@downcity/plugins/skill";
import { SoundPlugin, type SoundPluginAsrInput, type SoundPluginModel, type SoundPluginTtsInput } from "@downcity/plugins/sound";
import { TaskPlugin } from "@downcity/plugins/task";
import { PlaywrightBrowserProvider, WebPlugin } from "@downcity/plugins/web";
import { WorkboardPlugin } from "@downcity/plugins/workboard";
import type { EmbassyUser } from "@downcity/federation";
import type { LocalDatabase } from "@/store/LocalDatabase.js";
import type { LocalCrypto } from "@/store/LocalCrypto.js";
import type { LocalCityStoreOptions } from "@/types/LocalCity.js";
import type { LocalEmbassySession } from "@/store/LocalEmbassySession.js";
import { get_local_plugins_path } from "@/store/LocalPaths.js";
import type { LocalPluginManifest, LocalPluginResourceItem } from "@/types/LocalPlugin.js";

const plugin_ajv = new Ajv2020({ allErrors: true, allowUnionTypes: true, strict: true });
(formats_plugin as unknown as (ajv: Ajv2020) => Ajv2020)(plugin_ajv);

/** Plugin constructor 的本地统一输入。 */
export interface LocalPluginType {
  /** 根据绑定配置创建 Plugin。 */
  new(input: { config: JsonObject; resources: LocalPluginResourceItem[] }): Plugin;
  /** Plugin 静态 Manifest。 */
  readonly manifest: LocalPluginManifest;
  /** 创建或刷新 Resource 时使用的可选 Resolver。 */
  readonly resolve_resource?: (input: { resource: JsonObject }) => Promise<JsonObject> | JsonObject;
}

const skill_manifest: LocalPluginManifest = {
  name: "skill", title: "Skill Catalog And Loader",
  description: "Lists and reads local skills, and injects discovery guidance.",
};
const workboard_manifest: LocalPluginManifest = {
  name: "workboard", title: "Workboard Snapshot",
  description: "Collects structured Agent runtime activity snapshots.",
};
const contact_manifest: LocalPluginManifest = {
  name: "contact", title: "Contact",
  description: "Manages trusted relationships and exchanges with remote Agents.",
};
const task_manifest: LocalPluginManifest = {
  name: "task", title: "Task",
  description: "Manages reusable tasks and their trigger runtime.",
};
const chat_manifest: LocalPluginManifest = {
  name: "chat", title: "Chat",
  description: "Connects Agents to Telegram, Feishu, and QQ channels.",
  config: { schema: CHAT_PLUGIN_CONFIG_JSON_SCHEMA, defaults: {} },
  resources: { schema: CHAT_PLUGIN_RESOURCE_JSON_SCHEMA },
};
const web_manifest: LocalPluginManifest = {
  name: "web", title: "Web",
  description: "Provides structured browser sessions through a configured CDP endpoint.",
  config: {
    schema: {
      type: "object", additionalProperties: false, required: ["cdp_url"],
      properties: {
        cdp_url: { type: "string", minLength: 1 },
        default_url: { type: "string" },
        timeout_ms: { type: "integer", minimum: 1000, maximum: 60000 },
        max_observation_chars: { type: "integer", minimum: 1, maximum: 100000 },
      },
    },
    defaults: {},
  },
};
const memory_manifest: LocalPluginManifest = {
  name: "memory", title: "Memory",
  description: "Provides provider-neutral long-term memory, recall, revision, and deletion.",
  config: {
    schema: {
      type: "object", additionalProperties: false, required: ["provider", "storage"],
      properties: {
        provider: { type: "string", const: "builtin" },
        storage: { type: "string", const: "file" },
        root_path: { type: "string", minLength: 1 },
      },
    },
    defaults: { provider: "builtin", storage: "file" },
  },
};
const image_manifest: LocalPluginManifest = {
  name: "image", title: "Image",
  description: "Discovers image models, generates images, and reads results.",
};
const sound_manifest: LocalPluginManifest = {
  name: "sound", title: "Sound",
  description: "Discovers speech models and provides ASR and TTS.",
};

/** 本地 Plugin 装配器。 */
export class LocalPluginLoader {
  constructor(
    private readonly database: LocalDatabase,
    private readonly crypto_adapter: LocalCrypto,
    private readonly embassy_session: LocalEmbassySession,
    private readonly options: LocalCityStoreOptions,
  ) {}

  /** 按 Agent 定义恢复全部已启用 Plugin。 */
  async load_plugins(agent_id: string, definitions: readonly AgentPluginDefinition[]): Promise<Plugin[]> {
    const plugins: Plugin[] = [];
    for (const definition of definitions) {
      if (!definition.enabled) continue;
      const types = await this.load_plugin_types(definition.plugin_name);
      const plugin_type = types.find((item) => item.manifest.name === definition.plugin_name);
      if (!plugin_type) throw new Error(`Plugin not found: ${definition.plugin_name}`);
      validate_schema_value(definition.config, plugin_type.manifest.config?.schema, "Plugin config");
      const resources = this.resolve_resources(definition.plugin_name, definition.resource_ids)
        .map((resource) => {
          validate_schema_value(resource, plugin_type.manifest.resources?.schema, "Plugin Resource");
          return resource;
        });
      const plugin = new plugin_type({ config: definition.config, resources });
      if (plugin.name !== definition.plugin_name) {
        throw new Error(`Plugin constructor name mismatch: ${definition.plugin_name}`);
      }
      plugins.push(plugin);
    }
    return plugins;
  }

  /** 加载指定 Plugin 所属入口的完整 constructor 数组。 */
  async load_plugin_types(plugin_name: string): Promise<LocalPluginType[]> {
    const builtin_types = this.create_builtin_types();
    if (builtin_types.some((item) => item.manifest.name === plugin_name)) return builtin_types;
    return await this.load_installed_types(plugin_name) ?? [];
  }

  /** 读取绑定的 Resource 完整配置。 */
  private resolve_resources(plugin_name: string, resource_ids: readonly string[]): LocalPluginResourceItem[] {
    return resource_ids.map((resource_id) => {
      const row = this.database.sqlite.prepare(`
        SELECT item_encrypted FROM plugin_resources
        WHERE plugin_name = ? AND resource_id = ? LIMIT 1;
      `).get(plugin_name, resource_id) as { item_encrypted?: string } | undefined;
      if (!row?.item_encrypted) throw new Error(`Plugin Resource not found: ${plugin_name}/${resource_id}`);
      return JSON.parse(this.crypto_adapter.decrypt(row.item_encrypted)) as LocalPluginResourceItem;
    });
  }

  /** 加载第三方安装入口；入口协议仍由现有安装器写入数据库。 */
  private async load_installed_types(plugin_name: string): Promise<LocalPluginType[] | null> {
    const row = this.database.sqlite.prepare(`
      SELECT installation_id, entry_path, manifest_json FROM plugin_installations
      WHERE EXISTS (
        SELECT 1 FROM json_each(manifest_json, '$.plugins')
        WHERE json_extract(json_each.value, '$.name') = ?
      ) LIMIT 1;
    `).get(plugin_name) as { installation_id?: string; entry_path?: string; manifest_json?: string } | undefined;
    if (!row?.installation_id || !row.entry_path || !row.manifest_json) return null;
    const manifest = JSON.parse(row.manifest_json) as { entry?: unknown; plugins?: unknown };
    if (typeof manifest.entry !== "string" || !Array.isArray(manifest.plugins)) {
      throw new Error(`Plugin installation manifest is invalid: ${row.installation_id}`);
    }
    const installation_root = path.join(get_local_plugins_path(this.options.root_path || ""), row.installation_id);
    const expected_entry = resolve_artifact_path(installation_root, manifest.entry);
    const [real_root, real_entry, stored_entry] = await Promise.all([
      fs.realpath(installation_root), fs.realpath(expected_entry), fs.realpath(row.entry_path),
    ]);
    if (!real_entry.startsWith(`${real_root}${path.sep}`) || real_entry !== stored_entry) {
      throw new Error(`Installed Plugin entry is invalid: ${row.installation_id}`);
    }
    const module = await import(pathToFileURL(real_entry).href) as { plugins?: unknown };
    if (!Array.isArray(module.plugins)) throw new Error("Plugin entry must export a plugins array");
    const plugin_types = validate_plugin_types(module.plugins);
    if (canonical_json(plugin_types.map((item) => item.manifest)) !== canonical_json(manifest.plugins)) {
      throw new Error(`Plugin static manifests do not match installed snapshot: ${row.installation_id}`);
    }
    return plugin_types;
  }

  /** 创建当前本地宿主可用的内建 Plugin constructor。 */
  create_builtin_types(): LocalPluginType[] {
    const embassy_user = this.create_embassy_user();
    const platform_root_path = this.options.root_path || "";
    const city_plugin_context = {
      env: process.env,
      host: this.options.host,
      port: this.options.port,
    };
    class LocalSkillPlugin extends SkillPlugin {
      static readonly manifest = skill_manifest;
      constructor() { super(); }
    }
    class LocalWorkboardPlugin extends WorkboardPlugin {
      static readonly manifest = workboard_manifest;
      constructor() { super(); }
    }
    class LocalContactPlugin extends ContactPlugin {
      static readonly manifest = contact_manifest;
      constructor() { super({ host: city_plugin_context.host, port: city_plugin_context.port }); }
    }
    class LocalTaskPlugin extends TaskPlugin {
      static readonly manifest = task_manifest;
      constructor() { super(); }
    }
    class LocalChatPlugin extends ChatPlugin {
      static readonly manifest = chat_manifest;
      static readonly resolve_resource = async ({ resource }: { resource: JsonObject }) =>
        await resolve_chat_plugin_resource(resource);
      constructor(input: { config: JsonObject; resources: LocalPluginResourceItem[] }) {
        const config = parse_chat_plugin_config(input.config);
        const resources = input.resources.map(parse_chat_plugin_resource);
        super({ queue: config.queue, channels: create_chat_channels(resources) });
      }
    }
    class LocalMemoryPlugin extends MemoryPlugin {
      static readonly manifest = memory_manifest;
      constructor(input: { config: JsonObject }) {
        const provider = read_required_string(input.config, "provider", "Memory Plugin");
        const storage = read_required_string(input.config, "storage", "Memory Plugin");
        if (provider !== "builtin") throw new Error(`Unsupported Memory Provider: ${provider}`);
        if (storage !== "file") throw new Error(`Unsupported Memory Storage Adapter: ${storage}`);
        const root_path = read_optional_string(input.config, "root_path");
        if (root_path && !path.isAbsolute(root_path)) throw new Error("Memory Plugin root_path must be absolute");
        super({
          provider: new BuiltinMemoryProvider({
            create_storage: ({ agent_id }) => new FileMemoryStorageAdapter({
              root_path: root_path || get_default_file_memory_root_path({
                platform_root_path,
                agent_id,
              }),
            }),
          }),
        });
      }
    }
    class LocalWebPlugin extends WebPlugin {
      static readonly manifest = web_manifest;
      constructor(input: { config: JsonObject }) {
        const cdp_url = read_required_string(input.config, "cdp_url", "Web Plugin");
        const default_url = read_optional_string(input.config, "default_url");
        const timeout_ms = read_optional_number(input.config, "timeout_ms");
        const max_observation_chars = read_optional_number(input.config, "max_observation_chars");
        super({ browser: new PlaywrightBrowserProvider({
          cdp_url,
          ...(default_url ? { default_url } : {}),
          ...(timeout_ms !== undefined ? { timeout_ms } : {}),
          ...(max_observation_chars !== undefined ? { max_observation_chars } : {}),
        }) });
      }
    }
    class LocalImagePlugin extends ImagePlugin {
      static readonly manifest = image_manifest;
      constructor() {
        super({
          list_models: async () => {
            const catalog = await embassy_user?.ai.catalog();
            return (catalog?.forModality("image") ?? []).map((model): ImagePluginModel => ({
              id: model.id, name: model.name, description: model.description,
              modalities: model.modalities, tags: model.tags, meta: JSON.parse(JSON.stringify(model.meta ?? {})),
            }));
          },
          image_create: async (input: ImagePluginResolvedInput) => await embassy_user!.ai.image_create({ ...input, model: require_model(input, "image_create") }),
          image_result: async (input) => await embassy_user!.ai.image_result(input),
        });
      }
    }
    class LocalSoundPlugin extends SoundPlugin {
      static readonly manifest = sound_manifest;
      constructor() {
        super({
          list_models: async () => {
            const catalog = await embassy_user?.ai.catalog();
            return (catalog?.all() ?? []).filter((model) => model.modalities.includes("asr") || model.modalities.includes("tts")).map((model): SoundPluginModel => ({
              id: model.id, name: model.name, description: model.description,
              modalities: model.modalities, tags: model.tags, meta: JSON.parse(JSON.stringify(model.meta ?? {})),
            }));
          },
          asr: async (input: SoundPluginAsrInput) => await embassy_user!.ai.asr({ ...input, model: require_model(input, "asr") }),
          tts: async (input: SoundPluginTtsInput) => await embassy_user!.ai.tts({ ...input, model: require_model(input, "tts") }),
        });
      }
    }
    return [
      LocalSkillPlugin,
      LocalWorkboardPlugin,
      LocalContactPlugin,
      LocalTaskPlugin,
      LocalChatPlugin,
      LocalMemoryPlugin,
      LocalWebPlugin,
      LocalImagePlugin,
      LocalSoundPlugin,
    ] as unknown as LocalPluginType[];
  }

  /** 创建可选 Federation 用户能力；未登录时只在实际调用对应 Plugin 时失败。 */
  private create_embassy_user(): EmbassyUser | null {
    try {
      return this.embassy_session.create_user(process.env);
    } catch {
      return null;
    }
  }
}

/** 从 Plugin 输入中读取模型 ID。 */
function require_model(input: unknown, capability: string): string {
  const model = input && typeof input === "object" ? (input as { model?: unknown }).model : undefined;
  const model_id = typeof model === "string" ? model.trim() : "";
  if (!model_id) throw new TypeError(`${capability} requires model id`);
  return model_id;
}

/** 创建 Chat Plugin 渠道对象。 */
function create_chat_channels(resources: ChatPluginResource[]) {
  const resource_types = new Set<string>();
  return resources.map((resource) => {
    if (resource_types.has(resource.type)) {
      throw new Error(`Chat Plugin Resource type is duplicated: ${resource.type}`);
    }
    resource_types.add(resource.type);
    if (resource.type === "telegram") return new TelegramChannel({ id: resource.id, name: resource.name, bot_token: resource.bot_token });
    if (resource.type === "feishu") return new FeishuChannel({ id: resource.id, name: resource.name, app_id: resource.app_id, app_secret: resource.app_secret, domain: resource.domain });
    return new QqChannel({ id: resource.id, name: resource.name, app_id: resource.app_id, app_secret: resource.app_secret, sandbox: resource.sandbox });
  });
}

/** 按可选 JSON Schema 校验 Plugin 配置或 Resource。 */
function validate_schema_value(value: JsonObject, schema: JsonObject | undefined, label: string): void {
  if (!schema) return;
  const validate = plugin_ajv.compile(schema);
  if (validate(value)) return;
  const details = validate.errors
    ?.map((error) => `${error.instancePath || label} ${error.message || error.keyword}`)
    .join("; ") || "unknown validation error";
  throw new Error(`Invalid ${label}: ${details}`);
}

/** 校验第三方入口导出的 constructor 数组。 */
function validate_plugin_types(values: unknown[]): LocalPluginType[] {
  const plugin_types = values.map((value, index) => {
    if (typeof value !== "function") throw new Error(`Plugin array item must be a constructor: ${index}`);
    const plugin_type = value as LocalPluginType;
    const manifest = plugin_type.manifest;
    if (!manifest || typeof manifest !== "object" || !manifest.name || !manifest.description) {
      throw new Error(`Plugin constructor static manifest is invalid: ${index}`);
    }
    if (plugin_type.resolve_resource !== undefined && typeof plugin_type.resolve_resource !== "function") {
      throw new Error(`Plugin static resolve_resource must be a function: ${manifest.name}`);
    }
    return plugin_type;
  });
  const names = plugin_types.map((item) => item.manifest.name);
  if (new Set(names).size !== names.length) throw new Error("Plugin constructor manifest names must be unique");
  return plugin_types;
}

/** 安全解析安装目录内的 ESM 入口。 */
function resolve_artifact_path(root_path: string, relative_path: string): string {
  const root = path.resolve(root_path);
  const resolved = path.resolve(root, relative_path);
  if (resolved === root || !resolved.startsWith(`${root}${path.sep}`)) {
    throw new Error("Plugin entry must stay inside the installation directory");
  }
  return resolved;
}

/** 生成稳定 JSON，用于比较安装快照与运行时 Manifest。 */
function canonical_json(value: unknown): string {
  return JSON.stringify(sort_json(value));
}

/** 递归排序 JSON 对象 key。 */
function sort_json(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sort_json);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, sort_json(item)]));
  }
  return value;
}

/** 从 Plugin 配置读取必填字符串。 */
function read_required_string(config: JsonObject, key: string, owner: string): string {
  const value = read_optional_string(config, key);
  if (!value) throw new TypeError(`${owner} requires ${key}`);
  return value;
}

/** 从 Plugin 配置读取可选字符串。 */
function read_optional_string(config: JsonObject, key: string): string | undefined {
  const value = config[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

/** 从 Plugin 配置读取可选有限数值。 */
function read_optional_number(config: JsonObject, key: string): number | undefined {
  const value = config[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}
