/**
 * Desktop native Agent 控制器。
 *
 * Electron main 直接持有 City 和本地 Agent。Registry 只保存 Agent 与 Workspace 两类
 * 独立记录；连接时读取 Agent 的持久化绑定，不启动 CLI daemon，也不经过本机 RPC。
 */

import { Agent, type SessionMessage } from "@downcity/agent";
import {
  City,
  LocalCityStore,
  type LocalAgentConfig,
  type LocalWorkspaceConfig,
} from "@downcity/city";
import type {
  DesktopAgentRuntime,
  DesktopAgentSummary,
  DesktopChatMessage,
  DesktopChatResult,
  DesktopSessionSummary,
  DesktopWorkspaceSummary,
} from "../../common/types/DesktopApi.js";
import { create_desktop_city_environment } from "./DesktopCityEnvironment.js";

/** Electron main 内的 native Agent 生命周期控制器。 */
export class AgentController {
  /** Desktop 进程拥有的全部 native Agent。 */
  private readonly store = new LocalCityStore();

  /** Desktop 进程提供的平台运行环境。 */
  private readonly environment = create_desktop_city_environment(this.store);

  /** Desktop 进程拥有的全部 native Agent。 */
  private readonly city = new City(this.store, this.environment);

  /** City 是否已经完成本地 Agent 装配。 */
  private ready_promise = this.city.ready();

  /** 当前运行 Agent 实际使用的 Workspace。 */
  private readonly workspace_by_agent = new Map<string, DesktopWorkspaceSummary>();

  /** 列出 CLI 与 Desktop 共用的 Agent 注册记录。 */
  async list_agents(): Promise<DesktopAgentSummary[]> {
    await this.ready_promise;
    return this.store.list_agent_configs()
      .map(to_desktop_agent_summary);
  }

  /** 列出独立登记的全部 Workspace。 */
  async list_workspaces(): Promise<DesktopWorkspaceSummary[]> {
    await this.ready_promise;
    return this.store.list_workspace_configs().map(to_desktop_workspace_summary);
  }

  /** 创建 Agent，并把表单中的项目目录独立登记为 Workspace。 */
  async create_agent(
    agent_id: string,
    workspace_path: string,
    model_id: string,
  ): Promise<{ agent: DesktopAgentSummary; workspace: DesktopWorkspaceSummary }> {
    const normalized_model_id = String(model_id || "").trim();
    if (!normalized_model_id) throw new Error("model_id is required");
    const normalized_workspace_path = String(workspace_path || "").trim();
    if (!normalized_workspace_path) throw new Error("workspace_path is required");
    await this.ready_promise;
    const workspace = this.store.ensure_workspace({ workspace_path: normalized_workspace_path });
    const config = this.store.create_agent_config({
      agent_id,
      version: "1.0.0",
      execution: { type: "api", model_id: normalized_model_id },
    });
    this.store.bind_agent_workspace(config.agent_id, workspace.workspace_id);
    const agent_config = (await this.store.load_agent_configs())
      .find((item) => item.agent_id === config.agent_id);
    if (!agent_config) {
      throw new Error(`Agent config is not available for assembly: ${config.agent_id}`);
    }
    const agent = new Agent(await this.environment.create_agent_options(agent_config));
    await this.city.add(agent);
    return {
      agent: to_desktop_agent_summary({
        agent_id: agent.id,
        workspace_id: workspace.workspace_id,
        version: config.version,
        execution: config.execution,
      }),
      workspace: to_desktop_workspace_summary(workspace),
    };
  }

  /** 按 Agent 的持久化 Workspace 绑定创建或复用 Desktop native Agent。 */
  async connect_agent(agent_id: string): Promise<DesktopAgentRuntime> {
    await this.ready_promise;
    const config = this.store.get_agent_config(agent_id);
    if (!config) throw new Error(`Agent not found: ${agent_id}`);
    if (!config.workspace_id) throw new Error(`Agent has no Workspace binding: ${agent_id}`);
    const workspace = this.store.get_workspace_config(config.workspace_id);
    if (!workspace) throw new Error(`Agent Workspace is not registered: ${config.workspace_id}`);

    if (!this.city.agent(config.agent_id)) {
      throw new Error(`Agent is not available in Desktop City: ${config.agent_id}`);
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
    if (!this.city.agent(agent_id)) throw new Error(`Agent not found in City: ${agent_id}`);
    return this.city.require_agent(agent_id);
  }

  /** 释放 Desktop 进程拥有的全部 native Agent。 */
  async dispose(): Promise<void> {
    this.workspace_by_agent.clear();
    await this.city.dispose();
  }
}

/** 把 Registry Agent 收敛成 Renderer 所需摘要。 */
function to_desktop_agent_summary(record: Pick<LocalAgentConfig, "agent_id" | "workspace_id" | "version" | "execution">): DesktopAgentSummary {
  const model_id = typeof record.execution?.model_id === "string"
    ? record.execution.model_id
    : "";
  return {
    agent_id: record.agent_id,
    ...(record.workspace_id ? { workspace_id: record.workspace_id } : {}),
    model_id,
    version: record.version,
  };
}

/** 把 Registry Workspace 收敛成 Renderer 所需摘要。 */
function to_desktop_workspace_summary(
  record: LocalWorkspaceConfig,
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
