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
  generate_id,
  type AgentSessions,
  type AgentSession,
  type AgentSessionSetOptions,
  RemoteAgent,
  type RemoteSessionSetInput,
  type AgentSessionSummary,
  type RemoteAgentSession,
} from "@downcity/agent";
import type { AgentModel } from "@downcity/agent";
import { resolveDaemonRpcEndpoint } from "@/city/process/daemon/Client.js";
import {
  is_process_alive,
  read_daemon_meta,
  read_daemon_pid,
} from "@/city/process/daemon/Manager.js";
import {
  AGENT_CHAT_NEW_SESSION_ID_PREFIX,
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
import { create_cli_local_data } from "@/city/runtime/LocalData.js";
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
 * 生成 CLI chat 专用的新 session_id。
 */
export function createAgentChatSessionId(): string {
  return [
    AGENT_CHAT_NEW_SESSION_ID_PREFIX,
    Date.now(),
    generate_id().slice(0, 8),
  ].join("-");
}

/**
 * 解析 chat 远程目标地址。
 */
export async function resolveAgentChatRemoteTarget(params: {
  agent_id: string;
  workspace_id: string;
  transport?: AgentChatTransportOptions;
}): Promise<AgentChatRemoteTarget> {
  // 关键点（中文）：chat 固定走 Agent 本机 RPC，由 City 负责对外暴露。
  const endpoint = resolveDaemonRpcEndpoint({
    agent_id: params.agent_id,
    host: params.transport?.host,
    port: params.transport?.port,
  });
  return {
    url: `rpc://${endpoint.host}:${endpoint.port}/${encodeURIComponent(params.agent_id)}/${encodeURIComponent(params.workspace_id)}`,
  };
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
  const pid = await read_daemon_pid();
  const meta = pid && is_process_alive(pid) ? await read_daemon_meta() : null;
  if (!meta?.agent_ids.includes(params.agent_id)) {
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
        plugin_loader,
      });
      const workspace = await create_cli_workspace(workspace_config, data.root_path);
      return {
        sessions: create_local_chat_sessions(
          agent.enter(workspace).sessions,
          async (model_id) => await resolve_cli_agent_model(model_id, workspace.get_env()),
        ),
        close: async () => {
          await agent!.dispose();
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

/** 把本地 Session 的模型实例输入适配为 RemoteSession 的 model_id 输入。 */
function create_local_chat_sessions(
  sessions: AgentSessions<AgentSession>,
  resolve_model: (model_id: string) => Promise<AgentModel>,
): AgentSessions<RemoteAgentSession> {
  const wrap = (session: AgentSession): RemoteAgentSession => ({
    id: session.id,
    get_info: async () => await session.get_info(),
    prompt: async (input) => await session.prompt(input),
    stop: async () => await session.stop(),
    compact: async () => await session.compact(),
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
    create: async (input) => wrap(await sessions.create(input)),
    get: async (session_id) => wrap(await sessions.get(session_id)),
    list: async (input) => await sessions.list(input),
    archive: async (input) => await sessions.archive(input),
    archived: async (input) => await sessions.archived(input),
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

/**
 * 列出远程 chat session 摘要。
 */
export async function listRemoteChatSessions(params: {
  remote_agent: AgentChatClient;
}): Promise<AgentChatSessionSummaryView[]> {
  const page = await params.remote_agent.sessions.list({ limit: 30 });
  return page.items.map(toSessionSummaryView);
}

/**
 * 创建远程 chat session。
 */
export async function createRemoteChatSession(params: {
  remote_agent: AgentChatClient;
  session_id?: string;
}): Promise<{ session_id: string }> {
  const session_id = String(params.session_id || "").trim() || createAgentChatSessionId();
  const session = await params.remote_agent.sessions.create({
    session_id: session_id,
  });
  return {
    session_id: session.id,
  };
}

/**
 * 获取或创建远程 session。
 */
export async function getOrCreateRemoteSession(params: {
  remote_agent: AgentChatClient;
  session_id: string;
  create_new_session?: boolean;
}): Promise<RemoteAgentSession> {
  const collection = params.remote_agent.sessions;
  if (params.create_new_session === true) {
    return await collection.create({
      session_id: params.session_id,
    });
  }
  try {
    return await collection.get(params.session_id);
  } catch {
    return await collection.create({
      session_id: params.session_id,
    });
  }
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
    ...(summary.executing ? { executing: true } : {}),
  };
}

/**
 * 构建 session 选择项描述文本。
 */
export function buildSessionChoiceDescription(summary: AgentChatSessionSummaryView): string {
  const parts = [
    `${summary.message_count} messages`,
    summary.preview_text || "",
    summary.executing ? "running" : "",
  ].filter(Boolean);
  return parts.join(" · ");
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
