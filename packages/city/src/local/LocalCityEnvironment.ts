/**
 * LocalCityEnvironment：本地 Workspace、Shell、Model 与 Plugin 的运行环境。
 *
 * 本模块只提供平台相关组件，不创建 Agent。City 消费这些组件并拥有最终装配流程。
 * Federation 模型与官方 Plugin 必须由 CLI/Desktop 等宿主显式注入。
 */

import path from "node:path";
import { pathToFileURL } from "node:url";
import fs from "fs-extra";
import { Ajv2020 } from "ajv/dist/2020.js";
import formats_plugin from "ajv-formats";
import {
  Workspace,
  type AgentOptions,
  type AgentModel,
  type JsonObject,
  type Plugin,
  type WorkspaceBase,
} from "@downcity/agent";
import { AskQuestionsTool } from "@downcity/agent/tools";
import { Shell } from "@downcity/shell";
import type { CityAgentConfig } from "@/types/CityAgentConfig.js";
import type { CityEnvironment } from "@/types/CityEnvironment.js";
import { resolve_local_agent_env } from "@/local/store/LocalEnvironment.js";
import { get_local_plugins_path, resolve_local_root_path } from "@/local/store/LocalPaths.js";
import type { LocalPluginResourceItem } from "@/local/types/LocalPlugin.js";
import type {
  LocalCityEnvironmentOptions,
  LocalPluginType,
} from "@/local/types/LocalRuntime.js";
import type { LocalCityDataSource } from "@/local/types/LocalCityDataSource.js";

const plugin_ajv = new Ajv2020({ allErrors: true, allowUnionTypes: true, strict: true });
(formats_plugin as unknown as (ajv: Ajv2020) => Ajv2020)(plugin_ajv);

/** 本地 City 平台环境。 */
export class LocalCityEnvironment implements CityEnvironment {
  /** 用户级数据根目录。 */
  readonly root_path: string;

  /** 当前环境读取 Plugin Resource 与 Installation 使用的只读数据源。 */
  private readonly data_source?: LocalCityDataSource;

  /** 宿主显式提供的 Plugin constructor。 */
  private readonly builtin_types: readonly LocalPluginType[];

  /** 宿主显式提供的模型解析能力。 */
  private readonly model_resolver?: LocalCityEnvironmentOptions["model_resolver"];

  /** Environment 是否已经释放。 */
  private disposed = false;

  constructor(options: LocalCityEnvironmentOptions = {}) {
    this.root_path = resolve_local_root_path(options.root_path);
    this.data_source = options.data_source;
    this.builtin_types = [...(options.plugin_types ?? [])];
    this.model_resolver = options.model_resolver;
  }

  /** 将本地产品配置完整装配成纯运行时 Agent 参数。 */
  async create_agent_options(config: CityAgentConfig): Promise<AgentOptions> {
    const workspace = await this.create_workspace(config);
    try {
      const [model, plugins, tools] = await Promise.all([
        this.create_model(config, workspace),
        this.create_plugins(config),
        this.create_tools(),
      ]);
      return {
        id: config.agent_id,
        workspace,
        model,
        plugins,
        tools,
      };
    } catch (error) {
      await workspace.dispose().catch(() => undefined);
      throw error;
    }
  }

  /** 创建当前 Agent 独享的 Workspace、Shell 与 Sandbox。 */
  private async create_workspace(config: CityAgentConfig): Promise<Workspace> {
    this.assert_open();
    const env = resolve_local_agent_env({
      root_path: this.root_path,
      workspace_path: config.workspace.workspace_path,
      process_env: process.env,
    });
    return new Workspace({
      path: config.workspace.workspace_path,
      env,
      shell: new Shell({ sandbox: await create_platform_sandbox() }),
    });
  }

  /** 根据 Agent execution.model_id 创建可选模型。 */
  private async create_model(
    config: CityAgentConfig,
    workspace: WorkspaceBase,
  ): Promise<AgentModel | undefined> {
    this.assert_open();
    const model_id = read_model_id(config.execution);
    if (!model_id) return undefined;
    if (!this.model_resolver) throw new Error(`City Environment cannot resolve model: ${model_id}`);
    const env = workspace.get_env();
    return new LazyLocalAgentModel(
      model_id,
      async () => await this.resolve_model(model_id, env),
    );
  }

  /** 使用宿主模型解析器创建指定模型，供 Session 模型切换复用。 */
  async resolve_model(
    model_id_input: string,
    env: Readonly<Record<string, string>> = process.env as Record<string, string>,
  ): Promise<AgentModel> {
    this.assert_open();
    const model_id = String(model_id_input || "").trim();
    if (!model_id) throw new Error("model_id is required");
    if (!this.model_resolver) {
      throw new Error(`City Environment cannot resolve model: ${model_id}`);
    }
    return await this.model_resolver(model_id, env);
  }

  /** 根据 Agent 定义创建全部已启用 Plugin。 */
  private async create_plugins(config: CityAgentConfig): Promise<Plugin[]> {
    this.assert_open();
    const plugins: Plugin[] = [];
    for (const definition of config.plugins) {
      if (!definition.enabled) continue;
      const plugin_types = await this.load_plugin_types(definition.plugin_name);
      const plugin_type = plugin_types.find((item) =>
        item.manifest.name === definition.plugin_name
      );
      if (!plugin_type) throw new Error(`Plugin not found: ${definition.plugin_name}`);
      validate_schema_value(definition.config, plugin_type.manifest.config?.schema, "Plugin config");
      const resources = this.resolve_resources(
        definition.plugin_name,
        definition.resource_ids,
      );
      for (const resource of resources) {
        validate_schema_value(resource, plugin_type.manifest.resources?.schema, "Plugin Resource");
      }
      const plugin = new plugin_type({ config: definition.config, resources });
      if (plugin.name !== definition.plugin_name) {
        throw new Error(`Plugin constructor name mismatch: ${definition.plugin_name}`);
      }
      plugins.push(plugin);
    }
    return plugins;
  }

  /** 为本地 Agent 注入交互提问工具。 */
  private async create_tools(): Promise<NonNullable<AgentOptions["tools"]>> {
    this.assert_open();
    return {
      ask_question: AskQuestionsTool as unknown as NonNullable<AgentOptions["tools"]>[string],
    };
  }

  /** 返回宿主注入的内建 Plugin 类型快照。 */
  plugin_types(): LocalPluginType[] {
    this.assert_open();
    return [...this.builtin_types];
  }

  /** 加载一个 Plugin 所属入口的完整 constructor 集合。 */
  async load_plugin_types(plugin_name: string): Promise<LocalPluginType[]> {
    this.assert_open();
    if (this.builtin_types.some((item) => item.manifest.name === plugin_name)) {
      return [...this.builtin_types];
    }
    return await this.load_installed_types(plugin_name) ?? [];
  }

  /** 重新读取指定 Workspace 的环境快照。 */
  reload_workspace_env(workspace_path: string): Record<string, string> {
    this.assert_open();
    return resolve_local_agent_env({
      root_path: this.root_path,
      workspace_path,
      process_env: process.env,
    });
  }

  /** Environment 不拥有 Store 资源，释放只关闭自身生命周期。 */
  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
  }

  /** 读取一个 Plugin Binding 引用的全部解密 Resource。 */
  private resolve_resources(
    plugin_name: string,
    resource_ids: readonly string[],
  ): LocalPluginResourceItem[] {
    return resource_ids.map((resource_id) => {
      const resource = this.data_source?.get_plugin_resource(plugin_name, resource_id);
      if (!resource) {
        throw new Error(`Plugin Resource not found: ${plugin_name}/${resource_id}`);
      }
      return structuredClone(resource.item) as LocalPluginResourceItem;
    });
  }

  /** 加载并校验第三方 installation 的 ESM 入口。 */
  private async load_installed_types(plugin_name: string): Promise<LocalPluginType[] | null> {
    const installation = this.data_source?.list_plugin_installations()
      .find((item) => item.manifest.plugins.some((plugin) => plugin.name === plugin_name));
    if (!installation) return null;
    const manifest = installation.manifest;
    const installation_root = path.join(get_local_plugins_path(this.root_path), installation.installation_id);
    const expected_entry = resolve_artifact_path(installation_root, manifest.entry);
    const [real_root, real_entry, stored_entry] = await Promise.all([
      fs.realpath(installation_root),
      fs.realpath(expected_entry),
      fs.realpath(installation.entry_path),
    ]);
    if (!real_entry.startsWith(`${real_root}${path.sep}`) || real_entry !== stored_entry) {
      throw new Error(`Installed Plugin entry is invalid: ${installation.installation_id}`);
    }
    const module = await import(pathToFileURL(real_entry).href) as { plugins?: unknown };
    if (!Array.isArray(module.plugins)) {
      throw new Error("Plugin entry must export a plugins array");
    }
    const plugin_types = validate_plugin_types(module.plugins);
    if (canonical_json(plugin_types.map((item) => item.manifest)) !== canonical_json(manifest.plugins)) {
      throw new Error(`Plugin static manifests do not match installed snapshot: ${installation.installation_id}`);
    }
    return plugin_types;
  }

  /** 断言当前 Environment 尚未释放。 */
  private assert_open(): void {
    if (this.disposed) throw new Error("LocalCityEnvironment is disposed");
  }
}

type LanguageModelV3 = Extract<AgentModel, { readonly specificationVersion: "v3" }>;

/** 只在 Session 真正执行模型调用时解析 Federation 模型。 */
class LazyLocalAgentModel implements LanguageModelV3 {
  readonly specificationVersion = "v3" as const;
  readonly provider = "downcity";
  readonly supportedUrls: Record<string, RegExp[]> = {};
  readonly modelId: string;

  /** 首次模型调用建立的稳定解析 Promise。 */
  private model_promise?: Promise<LanguageModelV3>;

  constructor(
    model_id: string,
    private readonly resolve_model: () => Promise<AgentModel>,
  ) {
    this.modelId = model_id;
  }

  /** 转发非流式模型调用。 */
  async doGenerate(options: Parameters<LanguageModelV3["doGenerate"]>[0]) {
    return await (await this.model()).doGenerate(options);
  }

  /** 转发流式模型调用。 */
  async doStream(options: Parameters<LanguageModelV3["doStream"]>[0]) {
    return await (await this.model()).doStream(options);
  }

  /** 解析并缓存符合 LanguageModelV3 的真实模型。 */
  private async model(): Promise<LanguageModelV3> {
    this.model_promise ??= this.resolve_model().then((model) => {
      if (
        !model
        || typeof model !== "object"
        || !("specificationVersion" in model)
        || model.specificationVersion !== "v3"
      ) {
        throw new Error(`Resolved model does not implement LanguageModelV3: ${this.modelId}`);
      }
      return model as LanguageModelV3;
    });
    return await this.model_promise;
  }
}

/** 根据当前操作系统创建 Shell Sandbox Adapter。 */
async function create_platform_sandbox() {
  if (process.platform === "darwin") {
    const { MacOsSeatbeltSandbox } = await import("@downcity/sandbox-macos");
    return new MacOsSeatbeltSandbox();
  }
  if (process.platform === "linux") {
    const { LinuxBubblewrapSandbox } = await import("@downcity/sandbox-linux");
    return new LinuxBubblewrapSandbox();
  }
  if (process.platform === "win32") {
    const { WindowsMxcSandbox } = await import("@downcity/sandbox-windows-mxc");
    return new WindowsMxcSandbox();
  }
  throw new Error(`Unsupported platform: ${process.platform}`);
}

/** 从 Agent execution 读取模型 ID。 */
function read_model_id(execution: CityAgentConfig["execution"]): string {
  if (!execution || typeof execution.model_id !== "string") return "";
  return execution.model_id.trim();
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

/** 校验第三方入口导出的 Plugin constructor。 */
function validate_plugin_types(values: unknown[]): LocalPluginType[] {
  const plugin_types = values.map((value, index) => {
    if (typeof value !== "function") {
      throw new Error(`Plugin array item must be a constructor: ${index}`);
    }
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
  if (new Set(names).size !== names.length) {
    throw new Error("Plugin constructor manifest names must be unique");
  }
  return plugin_types;
}

/** 安全解析 installation 目录内的入口。 */
function resolve_artifact_path(root_path: string, relative_path: string): string {
  const root = path.resolve(root_path);
  const resolved = path.resolve(root, relative_path);
  if (resolved === root || !resolved.startsWith(`${root}${path.sep}`)) {
    throw new Error("Plugin entry must stay inside the installation directory");
  }
  return resolved;
}

/** 生成稳定 JSON，用于比较安装快照。 */
function canonical_json(value: unknown): string {
  return JSON.stringify(sort_json(value));
}

/** 递归排序 JSON object key。 */
function sort_json(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sort_json);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, sort_json(item)]));
  }
  return value;
}
