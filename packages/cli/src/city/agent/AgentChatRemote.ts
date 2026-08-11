/**
 * Agent Chat 远程连接与会话管理模块。
 *
 * 关键点（中文）
 * - 封装 `RemoteAgent` 创建、session 列表、session 创建/获取等远程操作。
 * - 不处理命令行交互与本地 agent 解析，只负责与 daemon RPC 的通信侧逻辑。
 */

import { generate_id } from "@/city/utils/Id.js";
import {
  RemoteAgent,
  type AgentSessionSummary,
  type RemoteAgentSession,
} from "@downcity/agent";
import { resolveDaemonRpcEndpoint } from "@/city/process/daemon/Client.js";
import {
  AGENT_CHAT_DEFAULT_SESSION_ID,
  AGENT_CHAT_NEW_SESSION_ID_PREFIX,
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
  transport?: AgentChatTransportOptions;
}): Promise<AgentChatRemoteTarget> {
  // 关键点（中文）：chat 固定走 Agent 本机 RPC，由 City 负责对外暴露。
  const endpoint = resolveDaemonRpcEndpoint({
    agent_id: params.agent_id,
    host: params.transport?.host,
    port: params.transport?.port,
  });
  return {
    url: `rpc://${endpoint.host}:${endpoint.port}`,
  };
}

/**
 * 创建 RemoteAgent 实例。
 */
export async function createRemoteAgent(params: {
  agent_id: string;
  transport?: AgentChatTransportOptions;
}): Promise<RemoteAgent> {
  const target = await resolveAgentChatRemoteTarget(params);
  return new RemoteAgent({
    url: target.url,
  });
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
  remote_agent: RemoteAgent;
}): Promise<AgentChatSessionSummaryView[]> {
  const page = await params.remote_agent.sessions.list({ limit: 30 });
  const sessions = page.items.map(toSessionSummaryView);
  if (!sessions.some((item) => item.session_id === AGENT_CHAT_DEFAULT_SESSION_ID)) {
    sessions.unshift({
      session_id: AGENT_CHAT_DEFAULT_SESSION_ID,
      message_count: 0,
    });
  }
  return sessions;
}

/**
 * 创建远程 chat session。
 */
export async function createRemoteChatSession(params: {
  remote_agent: RemoteAgent;
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
  remote_agent: RemoteAgent;
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
    "Agent daemon returned empty error (check config with `city agent status`)"
  );
}
