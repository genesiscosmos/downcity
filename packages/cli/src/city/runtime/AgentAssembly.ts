/**
 * CLI Agent 装配能力。
 *
 * CLI 组合根通过这些显式函数创建 Workspace、Model、Tool 与 Power Loader。City
 * 只接收已经创建完成的 Agent，不参与任何装配决策。
 */

import type { Federation } from "@downcity/federation";
import { SshWorkspace } from "@downcity/workspace-ssh";
import type { WorkspaceRuntime } from "@downcity/type/workspace";


import {
  LocalPowerLoader,
  resolve_workspace_ssh_access,
  type LocalAgentConfig,
  type LocalWorkspaceConfig,
  type PowerRepository,
  type LocalPowerRegistration,
} from "@downcity/city/local";
import {
  Agent,
  type AgentOptions,
} from "@downcity/agent";
import type { CityModelDescriptor, ModelClient } from "@downcity/type";
import { AskQuestionsTool } from "@downcity/agent/tools";
import { Shell, Workspace } from "@downcity/city";
import {
  create_builtin_power_registrations,
} from "@downcity/powers";
import { create_city_ai_model_client } from "@/city/runtime/city-model/CityAiServiceBinding.js";
import { resolve_local_agent_env } from "@downcity/city/local";
import { resolve_local_root_path } from "@downcity/city/local";
import { create_sandbox_provider } from "@/city/sandbox/PlatformSandbox.js";
import os from "node:os";

/** 创建 CLI 与 Desktop 可共享语义的官方 Power 注册集合。 */
export function create_cli_builtin_power_registrations(): LocalPowerRegistration[] {
  return create_builtin_power_registrations({
    platform_root_path: resolve_local_root_path(),
  });
}

/** 创建 CLI 读取本地 Power 定义与入口的 Loader。 */
export function create_cli_power_loader(input: {
  /** 当前 CLI 进程读取 Power 数据使用的仓储。 */
  power_repository: PowerRepository;
}): LocalPowerLoader {
  return new LocalPowerLoader({
    power_repository: input.power_repository,
    power_registrations: create_cli_builtin_power_registrations(),
  });
}

/** 使用文件型定义装配一个不绑定 Workspace 的 Agent。 */
export async function create_cli_agent(input: {
  /** Agent 的持久化配置。 */
  config: LocalAgentConfig;
  /** 可选的 Downcity 用户级数据根目录。 */
  root_path?: string;
  /** 与 City Power 共用的服务入口，由宿主拥有。 */
  federation?: Federation;
}): Promise<Agent> {
  resolve_local_root_path(input.root_path);
  const [model, tools] = await Promise.all([
    Promise.resolve(create_cli_agent_model(input.config, process_environment(), input.federation)),
    Promise.resolve(create_cli_agent_tools()),
  ]);
  return new Agent({
    id: input.config.agent_id,
    name: input.config.name,
    description: input.config.description,
    instruction: input.config.instruction,
    model,
    tools,
    resolve_work_model: async (model_id, workspace) =>
      await resolve_cli_agent_model(model_id, workspace?.get_env() ?? process_environment(),
        model_id === input.config.execution?.model_id ? read_reasoning_effort(input.config.execution) : undefined, input.federation),
  });
}

/** 创建 CLI Workspace 与其显式注入 Sandbox Provider 的 Shell。 */
export async function create_cli_workspace(
  config: LocalWorkspaceConfig,
  root_path_input?: string,
): Promise<WorkspaceRuntime> {
  if (config.source?.kind === "ssh") return new SshWorkspace({ id: config.workspace_id, name: config.name, host: config.source.host, root_path: config.workspace_path, canonical_root: true });
  const root_path = resolve_local_root_path(root_path_input);
  const ssh = await resolve_workspace_ssh_access(root_path, config);
  return new Workspace({
    id: config.workspace_id,
    name: config.name,
    path: config.workspace_path,
    env: resolve_local_agent_env({
      root_path,
      workspace_path: config.workspace_path,
      process_env: process.env,
      // 沙箱子进程拿不到父进程 HOME；由宿主显式提供，工具链才能定位用户目录。
      home_path: os.homedir(),
    }),
    shell: new Shell({
      sandbox_provider: create_sandbox_provider(ssh),
    }),
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
  federation?: Federation,
): ModelClient | undefined {
  const model_id = read_model_id(config.execution);
  return model_id
    ? new LazyCliModelClient(model_id, async () => await resolve_cli_agent_model(model_id, env, read_reasoning_effort(config.execution), federation))
    : undefined;
}

/** 使用 Federation AIService 解析 Session 或 Agent 模型。 */
export async function resolve_cli_agent_model(
  model_id_input: string,
  env: Readonly<Record<string, string>>,
  reasoning_effort?: string,
  federation?: Federation,
): Promise<ModelClient> {
  const model_id = String(model_id_input || "").trim();
  if (!model_id) throw new Error("model_id is required");
  const model = await create_city_ai_model_client({ modelId: model_id, env: { ...env }, federation });
  const reasoning = (model as ModelClient & Pick<CityModelDescriptor, "reasoning">).reasoning;
  if (!reasoning_effort || !reasoning?.efforts.some((effort) => effort.id === reasoning_effort)) return model;
  return {
    id: model.id,
    name: model.name,
    context_window: model.context_window,
    stream: (call, signal) => model.stream({
      ...call,
      reasoning: call.reasoning ?? { enabled: true, effort: reasoning_effort },
    }, signal),
  };
}

/** 创建 CLI 默认交互 Tool。 */
export function create_cli_agent_tools(): NonNullable<AgentOptions["tools"]> {
  return {
    ask_user: AskQuestionsTool as unknown as NonNullable<AgentOptions["tools"]>[string],
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
    home_path: os.homedir(),
  });
}

/** 在模型请求边界重新解析身份与模型，避免持有过期 Token。 */
class LazyCliModelClient implements ModelClient {
  readonly id: string;

  constructor(
    model_id: string,
    private readonly resolve_model: () => Promise<ModelClient>,
  ) {
    this.id = model_id;
  }

  async stream(call: Parameters<ModelClient["stream"]>[0], signal?: AbortSignal) {
    return await (await this.model()).stream(call, signal);
  }

  private async model(): Promise<ModelClient> {
    const model = await this.resolve_model();
    if (!model || typeof model.stream !== "function") {
      throw new Error(`Resolved model does not implement ModelClient: ${this.id}`);
    }
    return model;
  }
}

/** 从 Agent execution 读取可选的默认思考强度。 */
function read_reasoning_effort(execution: LocalAgentConfig["execution"]): string | undefined {
  return typeof execution?.reasoning_effort === "string" ? execution.reasoning_effort.trim() || undefined : undefined;
}

/** 从 Agent execution 读取模型 ID。 */
function read_model_id(execution: LocalAgentConfig["execution"]): string {
  return typeof execution?.model_id === "string" ? execution.model_id.trim() : "";
}
