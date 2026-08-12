/**
 * Desktop native Agent 控制器。
 *
 * Electron main 直接持有 City 和本地 Agent。Registry 只保存 Agent 与 Workspace 两类
 * 独立记录；每次连接显式组合二者，不启动 CLI daemon，也不经过本机 RPC。
 */

import {
  City,
  type Agent,
  type SessionMessage,
} from "@downcity/agent";
import {
  create_agent_registry_record,
  create_workspace_registry_record,
  get_agent_registry_record,
  get_workspace_registry_record,
  list_agent_registry_records,
  list_workspace_registry_records,
  normalize_agent_registry_workspace,
  type AgentRegistryRecord,
  type WorkspaceRegistryRecord,
} from "@downcity/agent-registry";
import { create_platform_agent } from "downcity/agent-host";
import type {
  DesktopAgentRuntime,
  DesktopAgentSummary,
  DesktopChatMessage,
  DesktopChatResult,
  DesktopSessionSummary,
  DesktopWorkspaceSummary,
} from "../../common/types/DesktopApi.js";

/** Electron main 内的 native Agent 生命周期控制器。 */
export class AgentController {
  /** Desktop 进程拥有的全部 native Agent。 */
  private readonly city = new City();

  /** 当前运行 Agent 实际使用的 Workspace。 */
  private readonly workspace_by_agent = new Map<string, DesktopWorkspaceSummary>();

  /** 列出 CLI 与 Desktop 共用的 Agent 注册记录。 */
  list_agents(): DesktopAgentSummary[] {
    return list_agent_registry_records().map(to_desktop_agent_summary);
  }

  /** 列出独立登记的全部 Workspace。 */
  list_workspaces(): DesktopWorkspaceSummary[] {
    return list_workspace_registry_records().map(to_desktop_workspace_summary);
  }

  /** 创建 Agent，并把表单中的项目目录独立登记为 Workspace。 */
  create_agent(
    agent_id: string,
    workspace_path: string,
    model_id: string,
  ): { agent: DesktopAgentSummary; workspace: DesktopWorkspaceSummary } {
    const normalized_model_id = String(model_id || "").trim();
    if (!normalized_model_id) throw new Error("model_id is required");
    const normalized_workspace_path = normalize_agent_registry_workspace(workspace_path);
    const agent = create_agent_registry_record({
      agent_id,
      version: "1.0.0",
      execution: { type: "api", model_id: normalized_model_id },
    });
    const workspace = create_workspace_registry_record({
      workspace_path: normalized_workspace_path,
    });
    return {
      agent: to_desktop_agent_summary(agent),
      workspace: to_desktop_workspace_summary(workspace),
    };
  }

  /** 以显式 Agent 与 Workspace 组合创建或替换 Desktop native Agent。 */
  async connect_agent(agent_id: string, workspace_id: string): Promise<DesktopAgentRuntime> {
    const config = get_agent_registry_record(agent_id);
    if (!config) throw new Error(`Agent not found: ${agent_id}`);
    const workspace = get_workspace_registry_record(workspace_id);
    if (!workspace) throw new Error(`Workspace not found: ${workspace_id}`);

    const current_workspace = this.workspace_by_agent.get(config.agent_id);
    const current_agent = this.city.get(config.agent_id);
    if (current_agent && current_workspace?.workspace_id === workspace.workspace_id) {
      return to_desktop_agent_runtime(config.agent_id, current_workspace);
    }

    this.workspace_by_agent.delete(config.agent_id);
    if (current_agent) await this.city.remove(config.agent_id);
    const runtime = await create_platform_agent({
      agent_id: config.agent_id,
      workspace_path: workspace.workspace_path,
    });
    try {
      this.city.add(runtime.agent);
    } catch (error) {
      await runtime.agent.dispose();
      throw error;
    }
    const workspace_summary = to_desktop_workspace_summary(workspace);
    this.workspace_by_agent.set(config.agent_id, workspace_summary);
    return to_desktop_agent_runtime(config.agent_id, workspace_summary);
  }

  /** 列出一个 native Agent 在当前 Workspace 中的 Session。 */
  async list_sessions(agent_id: string): Promise<DesktopSessionSummary[]> {
    const page = await this.require_native_agent(agent_id).sessions.list();
    return page.items.map((session) => ({
      session_id: session.session_id,
      title: session.title || session.session_id,
    }));
  }

  /** 在当前 Workspace 创建新的 Session。 */
  async create_session(agent_id: string): Promise<DesktopSessionSummary> {
    const session = await this.require_native_agent(agent_id).sessions.create();
    return { session_id: session.id, title: "新会话" };
  }

  /** 读取一个 native Session 的用户可见消息快照。 */
  async list_messages(agent_id: string, session_id: string): Promise<DesktopChatMessage[]> {
    const session = await this.require_native_agent(agent_id).sessions.get(session_id);
    const page = await session.messages();
    return page.items
      .filter((message) => message.visibility === "visible")
      .map(to_desktop_chat_message)
      .filter((message): message is DesktopChatMessage => message !== null);
  }

  /** 直接向 native Session 发送聊天输入并等待当前 Turn 完成。 */
  async send_message(
    agent_id: string,
    session_id: string,
    text: string,
  ): Promise<DesktopChatResult> {
    const query = String(text || "").trim();
    if (!query) throw new Error("message is required");
    const session = await this.require_native_agent(agent_id).sessions.get(session_id);
    const turn = await session.prompt({ query });
    const result = await turn.finished;
    return {
      session_id,
      text: result.text,
      success: result.success,
      ...(result.error ? { error: result.error } : {}),
    };
  }

  /** 读取由 Desktop City 持有的本地 Agent。 */
  private require_native_agent(agent_id: string): Agent {
    return this.city.require(agent_id);
  }

  /** 释放 Desktop 进程拥有的全部 native Agent。 */
  async dispose(): Promise<void> {
    this.workspace_by_agent.clear();
    await this.city.dispose();
  }
}

/** 把 Registry Agent 收敛成 Renderer 所需摘要。 */
function to_desktop_agent_summary(record: AgentRegistryRecord): DesktopAgentSummary {
  const model_id = typeof record.execution?.model_id === "string"
    ? record.execution.model_id
    : "";
  return {
    agent_id: record.agent_id,
    model_id,
    version: record.version,
  };
}

/** 把 Registry Workspace 收敛成 Renderer 所需摘要。 */
function to_desktop_workspace_summary(
  record: WorkspaceRegistryRecord,
): DesktopWorkspaceSummary {
  return {
    workspace_id: record.workspace_id,
    workspace_path: record.workspace_path,
    name: record.name,
  };
}

/** 构造 Desktop 当前 native Agent 运行目标。 */
function to_desktop_agent_runtime(
  agent_id: string,
  workspace: DesktopWorkspaceSummary,
): DesktopAgentRuntime {
  return { agent_id, workspace };
}

/** 把 canonical Session Message 投影为当前 Desktop Chat 的纯文本展示模型。 */
function to_desktop_chat_message(message: SessionMessage): DesktopChatMessage | null {
  if (message.type === "user") {
    const text = message.parts
      .flatMap((part) => part.type === "text" && "text" in part ? [part.text] : [])
      .join("\n")
      .trim();
    return text
      ? { message_id: message.message_id, role: "user", text, created_at: message.created_at, pending: false }
      : null;
  }
  if (message.type === "assistant") {
    const text = message.parts
      .flatMap((part) => part.type === "text" && "text" in part ? [part.text] : [])
      .join("\n")
      .trim();
    if (!text && message.status !== "streaming") return null;
    return {
      message_id: message.message_id,
      role: "assistant",
      text,
      created_at: message.created_at,
      pending: message.status === "streaming",
    };
  }
  if (message.type === "error") {
    return {
      message_id: message.message_id,
      role: "error",
      text: message.message,
      created_at: message.created_at,
      pending: false,
    };
  }
  const text = [message.title, message.description].filter(Boolean).join("\n");
  return {
    message_id: message.message_id,
    role: "system",
    text,
    created_at: message.created_at,
    pending: message.status === "running",
  };
}
