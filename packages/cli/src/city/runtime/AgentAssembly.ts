/**
 * CLI Agent 装配能力。
 *
 * CLI 组合根通过这些显式函数创建 Workspace、Model、Tool 与 Plugin Loader。City
 * 只接收已经创建完成的 Agent，不参与任何装配决策。
 */

import {
  LocalPluginLoader,
  type LocalAgentConfig,
  type LocalWorkspaceConfig,
  type PluginRepository,
  type LocalPluginType,
} from "@downcity/local/product";
import { Agent, type AgentModel, type AgentOptions, Workspace } from "@downcity/agent";
import { AskQuestionsTool } from "@downcity/agent/tools";
import { Shell } from "@downcity/shell";
import {
  create_builtin_plugin_types,
  type BuiltinPluginAi,
} from "@downcity/plugins";
import { EmbassySessionResolver } from "@/city/shared/EmbassySessionResolver.js";
import { createCityAiAgentModel } from "@/city/runtime/city-model/CityAiServiceBinding.js";
import { resolve_local_agent_env } from "@downcity/local/product";
import { resolve_local_root_path } from "@downcity/local";
import { create_platform_sandbox } from "@/city/sandbox/PlatformSandbox.js";

/** 创建 CLI 与 Desktop 可共享语义的官方 Plugin constructor 集合。 */
export function create_cli_builtin_plugin_types(input: {
  /** Downcity 用户级数据根目录。 */
  root_path?: string;
  /** Contact Plugin 报告的 HTTP 地址。 */
  host?: string;
  /** Contact Plugin 报告的 HTTP 端口。 */
  port?: number;
} = {}): LocalPluginType[] {
  const resolver = new EmbassySessionResolver();
  return create_builtin_plugin_types({
    platform_root_path: resolve_local_root_path(input.root_path),
    contact_http: { host: input.host, port: input.port },
    resolve_ai: async () => await create_builtin_plugin_ai(resolver),
  }) as LocalPluginType[];
}

/** 创建 CLI 读取本地安装和 Resource 使用的 Plugin Loader。 */
export function create_cli_plugin_loader(input: {
  /** Downcity 用户级数据根目录。 */
  root_path?: string;
  /** Contact Plugin 报告的 HTTP 地址。 */
  host?: string;
  /** Contact Plugin 报告的 HTTP 端口。 */
  port?: number;
  /** 当前 CLI 进程读取 Plugin 数据使用的仓储。 */
  plugin_repository: PluginRepository;
}): LocalPluginLoader {
  const root_path = resolve_local_root_path(input.root_path);
  return new LocalPluginLoader({
    root_path,
    plugin_repository: input.plugin_repository,
    plugin_types: create_cli_builtin_plugin_types(input),
  });
}

/** 使用产品层读取的配置装配一个由调用方持有的 Agent。 */
export async function create_cli_agent(input: {
  /** Agent 的持久化配置。 */
  config: LocalAgentConfig;
  /** Agent 绑定的 Workspace 持久化配置。 */
  workspace_config: LocalWorkspaceConfig;
  /** 当前产品实例创建的 Plugin Loader。 */
  plugin_loader: LocalPluginLoader;
  /** 可选的 Downcity 用户级数据根目录。 */
  root_path?: string;
}): Promise<Agent> {
  const workspace = await create_cli_workspace(input.workspace_config, input.root_path);
  try {
    const [model, plugins, tools] = await Promise.all([
      Promise.resolve(create_cli_agent_model(input.config, workspace.get_env())),
      input.plugin_loader.create_plugins(input.config),
      Promise.resolve(create_cli_agent_tools()),
    ]);
    return new Agent({
      id: input.config.agent_id,
      workspace,
      model,
      plugins,
      tools,
    });
  } catch (error) {
    await workspace.dispose().catch(() => undefined);
    throw error;
  }
}

/** 创建 CLI 当前 Agent 独享的 Workspace、Shell 与 Sandbox。 */
export async function create_cli_workspace(
  config: LocalWorkspaceConfig,
  root_path_input?: string,
): Promise<Workspace> {
  const root_path = resolve_local_root_path(root_path_input);
  return new Workspace({
    path: config.workspace_path,
    env: resolve_local_agent_env({
      root_path,
      workspace_path: config.workspace_path,
      process_env: process.env,
    }),
    shell: new Shell({ sandbox: await create_platform_sandbox() }),
  });
}

/** 根据 Agent 默认模型配置创建延迟解析的模型实例。 */
export function create_cli_agent_model(
  config: LocalAgentConfig,
  env: Readonly<Record<string, string>>,
): AgentModel | undefined {
  const model_id = read_model_id(config.execution);
  return model_id
    ? new LazyCliAgentModel(model_id, async () => await resolve_cli_agent_model(model_id, env))
    : undefined;
}

/** 使用 Federation AIService 解析 Session 或 Agent 模型。 */
export async function resolve_cli_agent_model(
  model_id_input: string,
  env: Readonly<Record<string, string>>,
): Promise<AgentModel> {
  const model_id = String(model_id_input || "").trim();
  if (!model_id) throw new Error("model_id is required");
  return await createCityAiAgentModel({ modelId: model_id, env: { ...env } });
}

/** 创建 CLI 默认交互 Tool。 */
export function create_cli_agent_tools(): NonNullable<AgentOptions["tools"]> {
  return {
    ask_question: AskQuestionsTool as unknown as NonNullable<AgentOptions["tools"]>[string],
  };
}

/** 重新读取 CLI Workspace 的完整环境快照。 */
export function reload_cli_workspace_env(
  workspace_path: string,
  root_path_input?: string,
): Record<string, string> {
  return resolve_local_agent_env({
    root_path: resolve_local_root_path(root_path_input),
    workspace_path,
    process_env: process.env,
  });
}

type LanguageModelV3 = Extract<AgentModel, { readonly specificationVersion: "v3" }>;

/** 首次模型调用时解析并缓存真实 Federation 模型。 */
class LazyCliAgentModel implements LanguageModelV3 {
  readonly specificationVersion = "v3" as const;
  readonly provider = "downcity";
  readonly supportedUrls: Record<string, RegExp[]> = {};
  readonly modelId: string;
  private model_promise?: Promise<LanguageModelV3>;

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

/** 从 Agent execution 读取模型 ID。 */
function read_model_id(execution: LocalAgentConfig["execution"]): string {
  return typeof execution?.model_id === "string" ? execution.model_id.trim() : "";
}

/** 把 Embassy User AI 子域投影为官方 Plugin 的最小协议。 */
async function create_builtin_plugin_ai(
  resolver: EmbassySessionResolver,
): Promise<BuiltinPluginAi> {
  const { embassy_user } = await resolver.create_user_client();
  return {
    async list_models() {
      const catalog = await embassy_user.ai.catalog();
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
      return await embassy_user.ai.image_create({
        ...input,
        model: require_model(input, "image_create"),
      });
    },
    async image_result(input) {
      return await embassy_user.ai.image_result(input);
    },
    async asr(input) {
      return await embassy_user.ai.asr({ ...input, model: require_model(input, "asr") });
    },
    async tts(input) {
      return await embassy_user.ai.tts({ ...input, model: require_model(input, "tts") });
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
