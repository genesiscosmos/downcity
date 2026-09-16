/**
 * Agent Chat 远程连接与会话管理模块。
 *
 * 关键点（中文）
 * - 封装 `RemoteAgent` 创建、session 列表、session 创建/获取等远程操作。
 * - City daemon 在线时通过 RPC 访问宿主；离线时保留本地装配路径供一次性 CLI 调用。
 * - 不处理命令行交互，只负责选择远程或本地访问路径。
 */

import {
  Agent,
  type AgentSessions,
  type AgentSession,
  type AgentSessionCollection,
  type AgentSessionSetOptions,
  type RemoteSessionSetInput,
  type AgentListSessionsInput,
  type AgentSessionSummary,
  type RemoteAgentSession,
} from "@downcity/agent";
import { City, LocalStorageProvider, RemoteAgent, type CityPluginHost, type CityRuntimeOptions } from "@downcity/city";
import type { ModelClient } from "@downcity/type";
import type { WorkspaceRuntime } from "@downcity/type/workspace";
import { resolveDaemonRpcEndpoint } from "@/city/process/daemon/Client.js";
import {
  is_process_alive,
  read_daemon_meta,
  read_daemon_pid,
} from "@/city/process/daemon/Manager.js";
import {
  type AgentChatSessionSummaryView,
  type AgentChatTransportOptions,
} from "@/city/agent/AgentChatTypes.js";
import { listPlatformModelChoices } from "@/city/runtime/city-model/ExecutionModelBinding.js";
import type { AgentChatModelChoice } from "@/city/types/AgentChatModel.js";
import {
  create_cli_agent,
  create_cli_workspace,
  create_cli_plugin_loader,
  resolve_cli_agent_model,
} from "@/city/runtime/AgentAssembly.js";
import { create_cli_local_data, type CliLocalData } from "@/city/runtime/LocalData.js";
import { resolve_cli_agent_target } from "@/city/agent/AgentSelection.js";

/**
 * 远端访问目标。
 */
export type AgentChatRemoteTarget = {
  /** 远端访问 URL。 */
  url: string;
};

/** Chat 所需的最小 Agent 客户端，由 City RPC 或本地装配路径提供。 */
export interface AgentChatClient {
  /** 目标 Agent 的 Session 集合。 */
  sessions: AgentSessions<RemoteAgentSession>;
  /** 释放远程连接或本地装配的 Agent。 */
  close(): Promise<void>;
}

/**
 * 解析 chat 远程目标地址。
 *
 * 关键点（中文）
 * - 省略 `workspace_id` 时生成 Agent 级地址，只用于跨 Workspace 会话发现。
 * - 带 `workspace_id` 时地址与请求都固定进入该 Workspace。
 */
export async function resolveAgentChatRemoteTarget(params: {
  agent_id: string;
  workspace_id?: string;
  transport?: AgentChatTransportOptions;
}): Promise<AgentChatRemoteTarget> {
  // 关键点（中文）：chat 固定走 Agent 本机 RPC，由 City 负责对外暴露。
  const endpoint = resolveDaemonRpcEndpoint({
    agent_id: params.agent_id,
    host: params.transport?.host,
    port: params.transport?.port,
  });
  const workspace_segment = String(params.workspace_id || "").trim()
    ? `/${encodeURIComponent(String(params.workspace_id).trim())}`
    : "";
  return {
    url: `rpc://${endpoint.host}:${endpoint.port}/${encodeURIComponent(params.agent_id)}${workspace_segment}`,
  };
}

/** 判断当前 CLI City daemon 是否已持有指定 Agent。 */
async function is_agent_held_by_daemon(agent_id: string): Promise<boolean> {
  const pid = await read_daemon_pid();
  const meta = pid && is_process_alive(pid) ? await read_daemon_meta() : null;
  return meta?.agent_ids.includes(agent_id) === true;
}

/**
 * 创建 RemoteAgent 实例。
 */
export async function createRemoteAgent(params: {
  agent_id: string;
  workspace?: string;
  transport?: AgentChatTransportOptions;
}): Promise<AgentChatClient> {
  const target_config = await resolve_cli_agent_target(params.agent_id, params.workspace);
  if (!(await is_agent_held_by_daemon(params.agent_id))) {
    const data = create_cli_local_data();
    const plugin_loader = create_cli_plugin_loader({ plugin_repository: data.plugins });
    let agent: Agent | undefined;
    try {
      const config = data.agents.get(params.agent_id);
      if (!config) throw new Error(`Agent not found: ${params.agent_id}`);
      const workspace_config = data.workspaces.get(target_config.workspace_id);
      if (!workspace_config) throw new Error(`Workspace not found: ${target_config.workspace_id}`);
      agent = await create_cli_agent({
        config,
      });
      const workspace = await create_cli_workspace(workspace_config, data.root_path);
      const city = new City({
        storage: new LocalStorageProvider(data.root_path),
        workspaces: [workspace],
        plugins: await plugin_loader.list_registrations(),
        plugin_host: create_local_plugin_host(data),
        runtime: create_local_city_runtime_options(data),
      });
      city.agents.add(agent);
      return {
        sessions: create_local_chat_sessions(
          agent.sessions,
          workspace,
          async (model_id) => await resolve_cli_agent_model(model_id, workspace.get_env()),
        ),
        close: async () => {
          await city.close();
          data.database.close();
        },
      };
    } catch (error) {
      await agent?.dispose().catch(() => undefined);
      data.database.close();
      throw error;
    }
  }
  const target = await resolveAgentChatRemoteTarget({
    ...params,
    workspace_id: target_config.workspace_id,
  });
  return new RemoteAgent({
    url: target.url,
  });
}

/**
 * 打开一个 Agent 级只读 Session 读取器。
 *
 * 关键点（中文）
 * - 只用于跨 Workspace 发现最近会话，不进入任何 Workspace。
 * - daemon 持有该 Agent 时走 Agent 级 RPC；否则走不绑定 Workspace 的本地装配。
 * - 读写、创建与恢复 Session 仍然必须携带 Workspace，由 `createRemoteAgent` 负责。
 */
export async function createAgentSessionReader(params: {
  agent_id: string;
  transport?: AgentChatTransportOptions;
}): Promise<AgentChatClient> {
  const agent_id = String(params.agent_id || "").trim();
  if (!agent_id) throw new Error("Agent id is required");
  if (await is_agent_held_by_daemon(agent_id)) {
    const target = await resolveAgentChatRemoteTarget({
      agent_id,
      transport: params.transport,
    });
    return new RemoteAgent({ url: target.url });
  }
  return await create_local_agent_session_reader(agent_id);
}

/** 构造 CLI 本地 Plugin 宿主回调。 */
function create_local_plugin_host(data: CliLocalData): CityPluginHost {
  return {
    config: (plugin_id) => ({
      get: () => structuredClone(data.plugins.get_config(plugin_id)),
      set: async (config) => {
        data.plugins.set_config(plugin_id, structuredClone(config));
      },
    }),
    notifications: () => ({
      publish: async () => {},
      dismiss: async () => {},
    }),
  };
}

/**
 * 构造 CLI 本地 City 运行时扩展。
 *
 * 关键点（中文）
 * - city tool 的可见性配置与插件配置同层：`plugins/city/config.toml`。
 * - 每次读取都重新取文件最新内容，用户改配置后下一个 Turn 即生效。
 */
function create_local_city_runtime_options(data: CliLocalData): CityRuntimeOptions {
  return {
    city_tool: {
      read_config: () => structuredClone(data.plugins.get_config("city")),
    },
  };
}

/** 在不绑定 Workspace 的本地装配中打开 Agent 级 Session 读取器。 */
async function create_local_agent_session_reader(agent_id: string): Promise<AgentChatClient> {
  const data = create_cli_local_data();
  const plugin_loader = create_cli_plugin_loader({ plugin_repository: data.plugins });
  let agent: Agent | undefined;
  try {
    const config = data.agents.get(agent_id);
    if (!config) throw new Error(`Agent not found: ${agent_id}`);
    agent = await create_cli_agent({ config });
    const city = new City({
      storage: new LocalStorageProvider(data.root_path),
      workspaces: [],
      plugins: await plugin_loader.list_registrations(),
      plugin_host: create_local_plugin_host(data),
      runtime: create_local_city_runtime_options(data),
    });
    city.agents.add(agent);
    return {
      sessions: create_local_session_reader(agent.sessions),
      close: async () => {
        await city.close();
        data.database.close();
      },
    };
  } catch (error) {
    await agent?.dispose().catch(() => undefined);
    data.database.close();
    throw error;
  }
}

/**
 * 把本地 Session 集合包装为只读发现视图。
 *
 * 说明（中文）
 * - `list` / `archived` 不绑定 Workspace，用于跨 Workspace 发现。
 * - `create` / `get` 依赖 Workspace 执行上下文，这里显式拒绝。
 */
function create_local_session_reader(
  sessions: AgentSessionCollection,
): AgentSessions<RemoteAgentSession> {
  const requires_workspace = async (): Promise<never> => {
    throw new Error("Opening a Session requires a Workspace; this reader only lists Sessions");
  };
  return {
    create: requires_workspace,
    get: requires_workspace,
    list: async (input) => await sessions.list(input),
    archive: async (input) => await sessions.archive(input),
    archived: async (input) => await sessions.archived(input),
    clean_archive: async () => await sessions.clean_archive(),
  };
}

/** 把本地 Session 的模型实例输入适配为 RemoteSession 的 model_id 输入。 */
function create_local_chat_sessions(
  sessions: AgentSessionCollection,
  workspace: WorkspaceRuntime,
  resolve_model: (model_id: string) => Promise<ModelClient>,
): AgentSessions<RemoteAgentSession> {
  const wrap = (session: AgentSession): RemoteAgentSession => ({
    id: session.id,
    workspace_id: session.workspace_id,
    origin: session.origin,
    get_info: async () => await session.get_info(),
    prompt: async (input) => await session.prompt(input),
    stop: async () => await session.stop(),
    subscribe: (subscriber) => session.subscribe(subscriber),
    messages: async (input) => await session.messages(input),
    system: async () => await session.system(),
    interactions: async () => await session.interactions(),
    status: async () => await session.status(),
    respond: async (input) => await session.respond(input),
    set: async (
      input: RemoteSessionSetInput,
      options?: AgentSessionSetOptions,
    ) => await session.set({
      ...(input.model_id ? {
        model: await resolve_model(input.model_id),
      } : {}),
      ...(input.security ? { security: input.security } : {}),
    }, options),
    fork: async (input) => wrap(await session.fork(input)),
  });
  return {
    create: async () => wrap(await sessions.create({ workspace })),
    get: async (session_id, origin_type) => wrap(await sessions.get(
      session_id,
      origin_type,
      { workspace },
    )),
    list: async (input) => await sessions.list({ ...input, workspace_id: workspace.id }),
    archive: async (input) => await sessions.archive(input),
    archived: async (input) => await sessions.archived({ ...input, workspace_id: workspace.id }),
    clean_archive: async () => await sessions.clean_archive(),
  };
}

/** 读取当前用户可用于 Chat Session 的模型目录。 */
export async function listAgentChatModelChoices(): Promise<AgentChatModelChoice[]> {
  const choices = await listPlatformModelChoices();
  return choices.map((choice) => ({
    model_id: choice.value,
    name: String(choice.model.name || choice.value).trim() || choice.value,
    modalities: choice.model.modalities.map((modality) => String(modality)),
  }));
}

/** chat Session 列表默认拉取上限。 */
const DEFAULT_CHAT_SESSION_LIST_LIMIT = 50;

/**
 * 列出远程 chat session 摘要。
 *
 * 说明（中文）
 * - 不传 `workspace_id` 时不限定 Workspace，用于发现最近会话。
 */
export async function listRemoteChatSessions(params: {
  remote_agent: AgentChatClient;
  input?: AgentListSessionsInput;
}): Promise<AgentChatSessionSummaryView[]> {
  const page = await params.remote_agent.sessions.list({
    limit: DEFAULT_CHAT_SESSION_LIST_LIMIT,
    ...params.input,
  });
  return page.items.map(toSessionSummaryView);
}

/**
 * 创建远程 chat session。
 */
export async function createRemoteChatSession(params: {
  remote_agent: AgentChatClient;
}): Promise<{ session_id: string }> {
  const session = await params.remote_agent.sessions.create();
  return {
    session_id: session.id,
  };
}

/**
 * 把 SDK session 摘要转换成 CLI 视图。
 */
export function toSessionSummaryView(
  summary: AgentSessionSummary,
): AgentChatSessionSummaryView {
  return {
    session_id: summary.session_id,
    ...(summary.title ? { title: summary.title } : {}),
    ...(summary.preview_text ? { preview_text: summary.preview_text } : {}),
    message_count: summary.message_count,
    ...(typeof summary.updated_at === "number" ? { updated_at: summary.updated_at } : {}),
    ...(summary.workspace_id ? { workspace_id: summary.workspace_id } : {}),
    ...(summary.executing ? { executing: true } : {}),
  };
}

/**
 * 构建 chat 失败提示文本。
 */
export function buildAgentChatFailureText(error?: string): string {
  return (
    String(error || "").trim() ||
    "Agent runtime returned an empty error (check `city status`)"
  );
}
