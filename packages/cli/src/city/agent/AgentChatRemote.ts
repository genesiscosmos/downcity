/**
 * Agent Chat 远程连接与会话管理模块。
 *
 * 关键点（中文）
 * - 封装 `RemoteAgent` 创建、session 列表、session 创建/获取等远程操作。
 * - 握手当前 City 宿主后通过已登记的 RPC 访问，不自动离线装配。
 * - 不处理命令行交互，资源浏览使用共用 ResourceClient。
 */

import {
  type AgentSessions,
  type AgentListSessionsInput,
  type AgentSessionSummary,
  type RemoteAgentSession,
} from "@downcity/agent";
import { RemoteAgent, read_city_host_state } from "@downcity/city";
import { request_management, resolve_resource_root, ResourceError } from "@downcity/city/local";
import {
  type AgentChatSessionSummaryView,
  type AgentChatTransportOptions,
} from "@/city/agent/AgentChatTypes.js";
import { listPlatformModelChoices } from "@/city/runtime/city-model/ExecutionModelBinding.js";
import type { AgentChatModelChoice } from "@/city/types/AgentChatModel.js";

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
  /** 完整 Agent ID。 */
  agent_id: string;
  /** 已登记 Workspace ID。 */
  workspace_id?: string;
  /** 显式数据根。 */
  root?: string;
  /** 由宿主发现取代的调用方 transport 提示。 */
  transport?: AgentChatTransportOptions;
}): Promise<AgentChatRemoteTarget> {
  const root_path = resolve_resource_root(params.root);
  const state = await read_city_host_state(root_path);
  if (!state) throw new ResourceError("host_offline", "Start City explicitly before chat", 5);
  await request_management(state, root_path, "handshake");
  if (!state.rpc_host || !state.rpc_port) throw new ResourceError("capability_missing", "Current host does not expose a Session transport", 5);
  const endpoint = { host: state.rpc_host, port: state.rpc_port };
  const workspace_segment = String(params.workspace_id || "").trim()
    ? `/${encodeURIComponent(String(params.workspace_id).trim())}`
    : "";
  return {
    url: `rpc://${endpoint.host}:${endpoint.port}/${encodeURIComponent(params.agent_id)}${workspace_segment}`,
  };
}



/**
 * 创建 RemoteAgent 实例。
 */
export async function createRemoteAgent(params: {
  /** 完整 Agent ID。 */
  agent_id: string;
  /** 由共用用例解析的稳定 Workspace ID。 */
  workspace?: string;
  /** 显式数据根。 */
  root?: string;
  /** 可选 transport 提示。 */
  transport?: AgentChatTransportOptions;
}): Promise<AgentChatClient> {
  const target = await resolveAgentChatRemoteTarget({
    ...params,
    workspace_id: params.workspace,
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
  const target = await resolveAgentChatRemoteTarget({ agent_id, transport: params.transport });
  return new RemoteAgent({ url: target.url });
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
