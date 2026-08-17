/**
 * Desktop Agent 装配能力。
 *
 * Electron main 通过这些显式函数创建 Workspace、Model、Tool 与 Plugin Loader。
 * 该模块不依赖 CLI，也不创建或持有 Agent。
 */

import {
  LocalPluginLoader,
  type LocalAgentConfig,
  type LocalWorkspaceConfig,
  resolve_local_agent_env,
  type LocalPluginRegistration,
} from "@downcity/local/product";
import { resolve_local_root_path } from "@downcity/local";
import { type AgentModel, type AgentOptions } from "@downcity/agent";
import { AskQuestionsTool } from "@downcity/agent/tools";
import { Shell, Workspace } from "@downcity/workspace";
import type { DesktopLocalData } from "./DesktopLocalData.js";
import { Embassy, type EmbassyUser } from "@downcity/federation";
import {
  create_builtin_plugin_registrations,
  create_builtin_plugin_services,
  type BuiltinPluginAi,
} from "@downcity/plugins";
import { create_desktop_platform_sandbox } from "./DesktopPlatformSandbox.js";
import type { DesktopModelSummary, DesktopPluginSummary } from "../../common/types/DesktopApi.js";

const default_federation_url = "https://base.downcity.ai";

/** Desktop 读取的最小 Embassy 用户 Session。 */
interface DesktopEmbassySession {
  /** Session 所属 Federation URL。 */
  federation_url: string;
  /** Federation 签发的用户 Token。 */
  user_token: string;
}

/** 共享安全配置中与 Desktop 身份恢复有关的最小投影。 */
interface DesktopDowncityConfig {
  /** 当前选中的 Federation URL。 */
  selected_federation_url?: string;
  /** 按 Federation URL 索引的用户 Session。 */
  sessions?: Record<string, DesktopEmbassySession>;
}

/** 创建 Electron main 使用的本地 Plugin Loader。 */
export function create_desktop_plugin_loader(
  data: DesktopLocalData,
): LocalPluginLoader {
  return new LocalPluginLoader({
    plugin_repository: data.plugins,
    plugin_registrations: create_desktop_builtin_plugin_registrations(data),
    services: create_builtin_plugin_services(async () => create_builtin_plugin_ai(create_embassy_user(data, process.env))),
  });
}

/** 创建 Desktop 当前 Agent 独享的 Workspace、Shell 与 Sandbox。 */
export async function create_desktop_workspace(
  data: DesktopLocalData,
  config: LocalWorkspaceConfig,
): Promise<Workspace> {
  return new Workspace({
    id: config.workspace_id,
    path: config.workspace_path,
    env: resolve_local_agent_env({
      root_path: data.root_path,
      workspace_path: config.workspace_path,
      process_env: process.env,
    }),
    shell: new Shell({ sandbox: await create_desktop_platform_sandbox() }),
  });
}

/** 根据 Agent 默认模型配置创建延迟解析的模型实例。 */
export function create_desktop_agent_model(
  data: DesktopLocalData,
  config: LocalAgentConfig,
  env: Readonly<Record<string, string>>,
): AgentModel | undefined {
  const model_id = typeof config.execution?.model_id === "string"
    ? config.execution.model_id.trim()
    : "";
  return model_id
    ? new LazyDesktopAgentModel(
      model_id,
      async () => await resolve_desktop_agent_model(data, model_id, env),
    )
    : undefined;
}

/** 通过 Desktop 当前 Embassy Session 解析 Federation 模型。 */
export async function resolve_desktop_agent_model(
  data: DesktopLocalData,
  model_id_input: string,
  env: Readonly<Record<string, string | undefined>>,
): Promise<AgentModel> {
  const model_id = String(model_id_input || "").trim();
  if (!model_id) throw new Error("model_id is required");
  const catalog = await create_embassy_user(data, env).ai.catalog();
  const model = catalog.get(model_id);
  if (!model || !model.modalities.some((item) => ["text", "stream", "openai"].includes(item))) {
    throw new Error(`Agent execution model not found in Federation: ${model_id}`);
  }
  return model;
}

/** 列出当前 Federation 中可见的全部模型；Renderer 按能力分组。 */
export async function list_desktop_agent_models(
  data: DesktopLocalData,
  env: Readonly<Record<string, string | undefined>>,
): Promise<DesktopModelSummary[]> {
  const catalog = await create_embassy_user(data, env).ai.catalog();
  return catalog.all()
    .map((model) => ({
      model_id: model.id,
      name: model.name || model.id,
      description: model.description || "",
      modalities: [...model.modalities],
      ...(typeof model.context_window === "number" ? { context_window: model.context_window } : {}),
      tags: [...(model.tags ?? [])],
      ...(model.price ? { price: [...model.price] } : {}),
    }));
}

/** 合并官方与第三方 Plugin，并附加 Agent 引用与 profile 摘要。 */
export function list_desktop_plugins(data: DesktopLocalData): DesktopPluginSummary[] {
  const registered_agents = new Map<string, string[]>();
  for (const agent of data.agents.list()) {
    for (const plugin_id of Object.keys(agent.plugins)) {
      const agent_ids = registered_agents.get(plugin_id) ?? [];
      agent_ids.push(agent.agent_id);
      registered_agents.set(plugin_id, agent_ids);
    }
  }
  const plugins = new Map<string, DesktopPluginSummary>();
  for (const registration of create_desktop_builtin_plugin_registrations(data)) {
    const definition = registration.definition;
    plugins.set(definition.id, {
      plugin_id: definition.id,
      title: definition.title || definition.id,
      description: definition.description || "",
      source: "builtin",
      agent_ids: registered_agents.get(definition.id) ?? [],
      profile_count: Object.keys(data.plugins.read_config(definition.id).profiles).length,
      profile_ids: Object.keys(data.plugins.read_config(definition.id).profiles),
      configurable: Boolean(definition.config),
    });
  }
  for (const installed of data.plugins.list_installed()) {
      plugins.set(installed.id, {
        plugin_id: installed.id,
        title: installed.title || installed.id,
        description: installed.description,
        version: installed.version,
        source: "installed",
        agent_ids: registered_agents.get(installed.id) ?? [],
        profile_count: Object.keys(data.plugins.read_config(installed.id).profiles).length,
        profile_ids: Object.keys(data.plugins.read_config(installed.id).profiles),
        configurable: Boolean(installed.config),
      });
  }
  return [...plugins.values()].sort((left, right) => left.title.localeCompare(right.title));
}

/** 创建 Desktop 默认交互 Tool。 */
export function create_desktop_agent_tools(): NonNullable<AgentOptions["tools"]> {
  return {
    ask_question: AskQuestionsTool as unknown as NonNullable<AgentOptions["tools"]>[string],
  };
}

type LanguageModelV3 = Extract<AgentModel, { readonly specificationVersion: "v3" }>;

/** 首次模型调用时解析并缓存 Desktop Federation 模型。 */
class LazyDesktopAgentModel implements LanguageModelV3 {
  readonly specificationVersion = "v3" as const;
  readonly provider = "downcity";
  readonly supportedUrls: Record<string, RegExp[]> = {};
  readonly modelId: string;

  constructor(
    model_id: string,
    private readonly resolve_model: () => Promise<AgentModel>,
  ) {
    this.modelId = model_id;
  }

  async doGenerate(options: Parameters<LanguageModelV3["doGenerate"]>[0]) {
    return await (await this.model()).doGenerate(options);
  }

  async doStream(options: Parameters<LanguageModelV3["doStream"]>[0]) {
    return await (await this.model()).doStream(options);
  }

  private async model(): Promise<LanguageModelV3> {
    const model = await this.resolve_model();
    if (
      !model
      || typeof model !== "object"
      || !("specificationVersion" in model)
      || model.specificationVersion !== "v3"
    ) {
      throw new Error(`Resolved model does not implement LanguageModelV3: ${this.modelId}`);
    }
    // 关键点（中文）：每个 Turn 重新读取共享 Federation Session，登录切换或退出后不能继续复用旧 Token。
    return model as LanguageModelV3;
  }
}

/** 创建 Desktop 宿主提供的官方 Plugin 注册。 */
export function create_desktop_builtin_plugin_registrations(
  data: DesktopLocalData,
): LocalPluginRegistration[] {
  return create_builtin_plugin_registrations({
  });
}

/** 把 Embassy User AI 子域投影成官方 Plugin 的最小协议。 */
function create_builtin_plugin_ai(user: EmbassyUser): BuiltinPluginAi {
  return {
    async list_models() {
      const catalog = await user.ai.catalog();
      return { items: catalog.all().map((model) => ({
        id: model.id,
        name: model.name,
        description: model.description,
        modalities: [...model.modalities],
        tags: model.tags ? [...model.tags] : undefined,
        meta: JSON.parse(JSON.stringify(model.meta ?? {})),
      })) };
    },
    async image_create(input) {
      return await user.ai.image_create({
        ...input,
        model: require_model(input, "image_create"),
      });
    },
    async image_result(input) {
      return await user.ai.image_result(input);
    },
    async asr(input) {
      return await user.ai.asr({ ...input, model: require_model(input, "asr") });
    },
    async tts(input) {
      return await user.ai.tts({ ...input, model: require_model(input, "tts") });
    },
  };
}

/** 从 Plugin 输入中读取必填模型 ID。 */
function require_model(input: unknown, capability: string): string {
  const model = input && typeof input === "object"
    ? (input as { model?: unknown }).model
    : undefined;
  const model_id = typeof model === "string" ? model.trim() : "";
  if (!model_id) throw new TypeError(`${capability} requires model id`);
  return model_id;
}

/** 按环境覆盖和共享持久化 Session 创建 Embassy User。 */
function create_embassy_user(
  data: DesktopLocalData,
  env: Readonly<Record<string, string | undefined>>,
): EmbassyUser {
  const config = data.settings.get<DesktopDowncityConfig>("downcity.config") ?? {};
  const federation_url = normalize_federation_url(
    read_string(env.DOWNCITY_FEDERATION_URL)
      || read_string(config.selected_federation_url)
      || default_federation_url,
  );
  const session = config.sessions?.[federation_url];
  const user_token = read_string(env.DOWNCITY_USER_TOKEN) || read_string(session?.user_token);
  if (!user_token) {
    throw new Error("Federation user token is required. Run `city federation login` first.");
  }
  return new Embassy({ federation_url, user_token }).user;
}

/** 规范化 Federation URL，并保留本机默认端口规则。 */
function normalize_federation_url(value: string): string {
  const raw = read_string(value);
  const has_protocol = /^[a-z][a-z\d+.-]*:\/\//iu.test(raw);
  const is_local = raw.startsWith("localhost") || /^\d+\.\d+\.\d+\.\d+/u.test(raw);
  const url = new URL(has_protocol ? raw : `${is_local ? "http" : "https"}://${raw}`);
  if (!url.port && (url.hostname === "localhost" || /^\d+\.\d+\.\d+\.\d+$/u.test(url.hostname))) {
    url.port = "43127";
  }
  return url.toString().replace(/\/+$/u, "");
}

/** 读取可选字符串。 */
function read_string(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}
