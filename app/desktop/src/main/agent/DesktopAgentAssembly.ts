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
  resolve_local_global_env,
} from "@downcity/city/local";
import { resolve_local_root_path } from "@downcity/city/local";
import { type AgentModel, type AgentOptions } from "@downcity/agent";
import { AskQuestionsTool } from "@downcity/agent/tools";
import { Shell, Workspace } from "@downcity/city";
import type { DesktopLocalData } from "./DesktopLocalData.js";
import { Embassy, type EmbassyUser } from "@downcity/federation";
import {
  create_builtin_plugin_registrations,
  type BuiltinPluginRegistration,
} from "@downcity/plugins";
import { create_desktop_platform_sandbox } from "./DesktopPlatformSandbox.js";
import type { DesktopModelSummary } from "../../common/types/DesktopApi.js";

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
  });
}

/** 创建 Desktop 当前 Agent 独享的 Workspace、Shell 与 Sandbox。 */
export async function create_desktop_workspace(
  data: DesktopLocalData,
  config: LocalWorkspaceConfig,
): Promise<Workspace> {
  return new Workspace({
    id: config.workspace_id,
    name: config.name,
    path: config.workspace_path,
    env: resolve_local_agent_env({
      root_path: data.root_path,
      workspace_path: config.workspace_path,
      process_env: {},
    }),
    shell: new Shell({ sandbox: await create_desktop_platform_sandbox() }),
  });
}

/** 解析 Desktop City 宿主使用的环境：显式进程环境覆盖 Global Env。 */
export function resolve_desktop_city_env(data: DesktopLocalData): Record<string, string> {
  return {
    ...resolve_local_global_env(data.root_path),
    ...Object.fromEntries(
      Object.entries(process.env).filter(
        (entry): entry is [string, string] => typeof entry[1] === "string",
      ),
    ),
  };
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

/** 根据 Group 的模型标识创建延迟解析的群聊意图模型。 */
export function create_desktop_group_model(
  data: DesktopLocalData,
  model_id_input: string,
  env: Readonly<Record<string, string>>,
): AgentModel | undefined {
  const model_id = String(model_id_input || "").trim();
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

/** 为 City 模型绑定 Desktop 当前 Session 选择的推理档位。 */
export function configure_desktop_agent_model(model: AgentModel, reasoning_effort?: string): AgentModel {
  const effort = reasoning_effort?.trim();
  if (!effort) return model;
  return new DesktopReasoningAgentModel(model, effort);
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
      ...(model.pricing ? {
        pricing: (Array.isArray(model.pricing) ? model.pricing : [model.pricing]).map((pricing) => ({
          currency: pricing.currency,
          unit: pricing.unit,
          ...(typeof pricing.scale === "number" ? { scale: pricing.scale } : {}),
          rates: { ...pricing.rates },
          ...(pricing.dimensions ? { dimensions: { ...pricing.dimensions } } : {}),
        })),
      } : {}),
      ...(model.reasoning ? {
        reasoning: {
          efforts: model.reasoning.efforts.map((effort) => ({
            id: effort.id,
            name: effort.name,
            ...(effort.description ? { description: effort.description } : {}),
          })),
          ...(model.reasoning.default_effort ? { default_effort: model.reasoning.default_effort } : {}),
        },
      } : {}),
    }));
}

/** 创建 Desktop 默认交互 Tool。 */
export function create_desktop_agent_tools(): NonNullable<AgentOptions["tools"]> {
  return {
    ask_question: AskQuestionsTool as unknown as NonNullable<AgentOptions["tools"]>[string],
  };
}

/** 首次模型调用时解析并缓存 Desktop Federation 模型。 */
class LazyDesktopAgentModel implements AgentModel {
  readonly id: string;

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
    const model = await this.resolve_model();
    if (!model || typeof model.stream !== "function") {
      throw new Error(`Resolved model does not implement ModelClient: ${this.id}`);
    }
    // 关键点（中文）：每个 Turn 重新读取共享 Federation Session，登录切换或退出后不能继续复用旧 Token。
    return model;
  }
}

/** 在不改变 Federation 模型对象的前提下绑定 reasoning。 */
class DesktopReasoningAgentModel implements AgentModel {
  readonly id: string;

  constructor(private readonly model: AgentModel, private readonly reasoning_effort: string) {
    this.id = model.id;
  }

  async stream(call: Parameters<AgentModel["stream"]>[0], signal?: AbortSignal) {
    return await this.model.stream({
      ...call,
      reasoning: { enabled: true, effort: this.reasoning_effort },
    }, signal);
  }
}

/** 创建 Desktop 宿主提供的官方 Plugin 注册。 */
export function create_desktop_builtin_plugin_registrations(
  data: DesktopLocalData,
): BuiltinPluginRegistration[] {
  return create_builtin_plugin_registrations();
}


/** 按环境覆盖和共享持久化 Session 创建完整 Embassy。 */
export function create_desktop_embassy(
  data: DesktopLocalData,
  env: Readonly<Record<string, string | undefined>>,
): Embassy {
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
  return new Embassy({ federation_url, user_token });
}

/** 按环境覆盖和共享持久化 Session 创建 Embassy User。 */
function create_embassy_user(
  data: DesktopLocalData,
  env: Readonly<Record<string, string | undefined>>,
): EmbassyUser {
  return create_desktop_embassy(data, env).user;
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
