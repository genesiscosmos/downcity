/**
 * CLI Agent 装配能力。
 *
 * CLI 组合根通过这些显式函数创建 Workspace、Model、Tool 与 Power Loader。City
 * 只接收已经创建完成的 Agent，不参与任何装配决策。
 */

import type { City, Town } from "@downcity/city";
import { SshWorkspace } from "@downcity/workspace-ssh";
import type { WorkspaceRuntime } from "@downcity/type/workspace";


import {
  LocalPowerLoader,
  resolve_workspace_ssh_access,
  type LocalAgentConfig,
  type ExtensionPlatform,
  type LocalWorkspaceConfig,
  type PowerRepository,
  type LocalPowerRegistration,
} from "@downcity/city/local";
import {
  Agent,
  DeferredModelClient,
  type AgentOptions,
} from "@downcity/agent";
import type { ModelClient } from "@downcity/type";
import { AskQuestionsTool } from "@downcity/agent/tools";
import { Shell, Workspace } from "@downcity/city";
import {
  create_builtin_power_registrations,
} from "@downcity/powers";
import { resolve_local_agent_env } from "@downcity/city/local";
import { resolve_local_root_path } from "@downcity/city/local";
import { create_sandbox_provider } from "@/city/sandbox/PlatformSandbox.js";
import os from "node:os";

/** 创建 CLI 与 Desktop 可共享语义的官方 Power 注册集合。 */
export function create_cli_builtin_power_registrations(get_city?: () => City): LocalPowerRegistration[] {
  return create_builtin_power_registrations({
    platform_root_path: resolve_local_root_path(),
    get_city,
  });
}

/** 创建 CLI 读取本地 Power 定义与入口的 Loader。 */
export function create_cli_power_loader(input: {
  /** 当前 CLI 进程读取 Power 数据使用的仓储。 */
  power_repository: PowerRepository;
  /** 运行 City 的延迟读取；后台模型恢复使用真实 Agent/Session SDK。 */
  get_city: () => City;
}): LocalPowerLoader {
  return new LocalPowerLoader({
    power_repository: input.power_repository,
    power_registrations: create_cli_builtin_power_registrations(input.get_city),
  });
}

/** 使用文件型定义装配一个不绑定 Workspace 的 Agent。 */
export async function create_cli_agent(input: {
  /** Agent 的持久化配置。 */
  config: LocalAgentConfig;
  /** 可选的 Downcity 用户级数据根目录。 */
  root_path?: string;
  /** 当前 City 唯一 Town 目录；模型 ID 和 binding 均通过此入口解析。 */
  town: Town;
  /** 当前 root 共享扩展模型和行为目录。 */
  extensions?: ExtensionPlatform;
}): Promise<Agent> {
  resolve_local_root_path(input.root_path);
  const [model, tools] = await Promise.all([
    Promise.resolve(create_cli_agent_model(input.config, input.town)),
    Promise.resolve(create_cli_agent_tools()),
  ]);
  const behavior = input.extensions?.agent_behavior(input.config, { model, tools }) ?? {};
  return new Agent({
    ...behavior,
    acquire_execution: behavior.acquire_execution,
    id: input.config.agent_id,
    name: input.config.name,
    description: input.config.description,
    instruction: input.config.instruction || behavior.instruction,
    model: model ?? behavior.model,
    tools: { ...tools, ...behavior.tools },
    resolve_work_model: async (model_id, _workspace, binding_id) =>
      binding_id === undefined ? unavailable_cli_model(model_id) : await resolve_cli_agent_model(model_id, input.town,
        model_id === input.config.execution?.model_id ? read_reasoning_effort(input.config.execution) : undefined, binding_id),
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

/** 恢复默认模型时保留历史浏览；不明确的旧来源直到执行时才要求重选。 */
export function create_cli_agent_model(config: LocalAgentConfig, town: Town): ModelClient | undefined {
  const model_id = read_model_id(config.execution);
  if (!model_id) return undefined;
  const binding_id = typeof config.execution?.binding_id === "string" ? config.execution.binding_id : undefined;
  if (!binding_id) return unavailable_cli_model(model_id);
  try { return create_bound_cli_model(model_id, town, read_reasoning_effort(config.execution), binding_id); }
  catch { return unavailable_cli_model(model_id, binding_id); }
}

/** HTTP/RPC/工作 resolver 透传已确认身份；明确选择模型时捕获当前来源。 */
export async function resolve_cli_agent_model(model_id: string, town: Town, reasoning_effort?: string, binding_id?: string): Promise<ModelClient> {
  if (!model_id) throw new Error("model_id is required");
  return create_bound_cli_model(model_id, town, reasoning_effort, binding_id);
}

/** Town 句柄先捕获身份，执行解析目录只补元数据，绝不追随换号后的身份。 */
function create_bound_cli_model(model_id: string, town: Town, reasoning_effort?: string, binding_id?: string): ModelClient {
  const captured = town.models.client(model_id, { binding_id });
  return new CliDeferredModelClient(model_id, async () => {
    const catalog = await town.models.list();
    const entry = catalog.items.find((item) => item.model_id === model_id);
    if (!entry) throw new Error("town_model_source_unavailable");
    const model = town.models.client(model_id, { binding_id: captured.binding_id });
    const reasoning = entry.reasoning;
    return { ...model, name: entry.name, context_window: entry.context_window,
      stream: (call, signal) => model.stream(reasoning_effort && reasoning?.efforts.some((effort) => effort.id === reasoning_effort)
        ? { ...call, reasoning: call.reasoning ?? { enabled: true, effort: reasoning_effort } } : call, signal) };
  }, captured.binding_id);
}

/** 明确缺失来源的历史句柄不会借用其他连接；历史浏览只读取 ID。 */
function unavailable_cli_model(model_id: string, binding_id?: string): ModelClient {
  return new CliDeferredModelClient(model_id, async () => {
    throw Object.assign(new Error("Saved model requires explicit source selection"), { code: "session_model_binding_changed" });
  }, binding_id);
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

/**
 * 接入 SDK 的执行前模型解析，让预算与请求使用同一份真实模型。
 * 每次 resolve 重新读取绑定；历史浏览只读取已解析元信息，不触发网络。
 * 标准 stream 入口继承 SDK 实现，由其调用本类 resolve 后执行真实模型。
 */
class CliDeferredModelClient extends DeferredModelClient {
  /** 最近一次执行解析的模型，仅用于同步元信息展示。 */
  private selected_model?: ModelClient;

  constructor(
    model_id: string,
    private readonly resolve_model: () => Promise<ModelClient>,
    binding_id?: string,
  ) {
    super(model_id, resolve_model, binding_id);
  }

  /** 浏览不联网；执行 resolve 完成后提供真实名称。 */
  override get name(): string | undefined { return this.selected_model?.name; }

  /** 执行输入组装时更新真实窗口，不能沿用其他 Federation 同 ID 模型的容量。 */
  override get context_window(): number | undefined { return this.selected_model?.context_window; }

  /** 覆写 SDK 的永久缓存；每次执行按当前 City 绑定解析完整客户端。 */
  override async resolve(): Promise<ModelClient> {
    const model = await this.resolve_model();
    if (model.id !== this.id || model.binding_id !== this.binding_id || model === this || typeof model.stream !== "function") {
      throw new Error(`Resolved model does not implement the selected ModelClient: ${this.id}`);
    }
    this.selected_model = model;
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
