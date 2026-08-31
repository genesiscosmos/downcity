/**
 * CLI Agent 装配能力。
 *
 * CLI 组合根通过这些显式函数创建 Workspace、Model、Tool 与 Plugin Loader。City
 * 只接收已经创建完成的 Agent，不参与任何装配决策。
 */

import path from "node:path";
import {
  LocalPluginLoader,
  type LocalAgentConfig,
  type LocalWorkspaceConfig,
  type PluginRepository,
  type LocalPluginRegistration,
} from "@downcity/local/product";
import { Agent, get_logger, type AgentModel, type AgentOptions } from "@downcity/agent";
import { AskQuestionsTool } from "@downcity/agent/tools";
import { Shell, Workspace } from "@downcity/workspace";
import {
  create_builtin_plugin_registrations,
} from "@downcity/plugins";
import { createCityAiAgentModel } from "@/city/runtime/city-model/CityAiServiceBinding.js";
import { resolve_local_agent_env } from "@downcity/local/product";
import { resolve_local_root_path } from "@downcity/local";
import { create_platform_sandbox } from "@/city/sandbox/PlatformSandbox.js";

/** 创建 CLI 与 Desktop 可共享语义的官方 Plugin 注册集合。 */
export function create_cli_builtin_plugin_registrations(): LocalPluginRegistration[] {
  return create_builtin_plugin_registrations();
}

/** 创建 CLI 读取本地 Plugin 定义与 profile 的 Loader。 */
export function create_cli_plugin_loader(input: {
  /** 当前 CLI 进程读取 Plugin 数据使用的仓储。 */
  plugin_repository: PluginRepository;
}): LocalPluginLoader {
  return new LocalPluginLoader({
    plugin_repository: input.plugin_repository,
    plugin_registrations: create_cli_builtin_plugin_registrations(),
  });
}

/** 使用文件型定义装配一个不绑定 Workspace 的 Agent。 */
export async function create_cli_agent(input: {
  /** Agent 的持久化配置。 */
  config: LocalAgentConfig;
  /** 当前产品实例创建的 Plugin Loader。 */
  plugin_loader: LocalPluginLoader;
  /** 可选的 Downcity 用户级数据根目录。 */
  root_path?: string;
}): Promise<Agent> {
  const root_path = resolve_local_root_path(input.root_path);
  const [model, plugins, tools] = await Promise.all([
    Promise.resolve(create_cli_agent_model(input.config, process_environment())),
    input.plugin_loader.create_plugins(input.config, ({ plugin_id, profile }) => ({
      plugin_id,
      profile,
      data_path: path.join(
        root_path,
        "agents",
        input.config.agent_id,
        "plugins",
        plugin_id,
      ),
      logger: get_logger(),
      extensions: {},
    })),
    Promise.resolve(create_cli_agent_tools()),
  ]);
  return new Agent({
    id: input.config.agent_id,
    instruction: input.config.instruction,
    model,
    plugins,
    tools,
  });
}

/** 创建 CLI 当前 Agent 独享的 Workspace、Shell 与 Sandbox。 */
export async function create_cli_workspace(
  config: LocalWorkspaceConfig,
  root_path_input?: string,
): Promise<Workspace> {
  const root_path = resolve_local_root_path(root_path_input);
  return new Workspace({
    id: config.workspace_id,
    path: config.workspace_path,
    env: resolve_local_agent_env({
      root_path,
      workspace_path: config.workspace_path,
      process_env: process.env,
    }),
    shell: new Shell({ sandbox: await create_platform_sandbox() }),
  });
}

/** 把当前进程环境投影为 Agent 级模型配置，不引入 Workspace 绑定。 */
function process_environment(): Record<string, string> {
  return Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  );
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

/** 首次模型调用时解析并缓存真实 Federation 模型。 */
class LazyCliAgentModel implements AgentModel {
  readonly id: string;
  private model_promise?: Promise<AgentModel>;

  constructor(
    model_id: string,
    private readonly resolve_model: () => Promise<AgentModel>,
  ) {
    this.id = model_id;
  }

  async stream(call: Parameters<AgentModel["stream"]>[0], signal?: AbortSignal) {
    return await (await this.model()).stream(call, signal);
  }

  private async model(): Promise<AgentModel> {
    this.model_promise ??= this.resolve_model().then((model) => {
      if (!model || typeof model.stream !== "function") {
        throw new Error(`Resolved model does not implement ModelClient: ${this.id}`);
      }
      return model;
    });
    return await this.model_promise;
  }
}

/** 从 Agent execution 读取模型 ID。 */
function read_model_id(execution: LocalAgentConfig["execution"]): string {
  return typeof execution?.model_id === "string" ? execution.model_id.trim() : "";
}
