/**
 * Desktop Agent 控制器。
 *
 * 负责把共享 Registry 和 Downcity CLI daemon 连接起来；Renderer 不直接接触
 * 文件系统、子进程或 Agent SDK。
 */
import { execFile } from "node:child_process";
import { promisify, stripVTControlCharacters } from "node:util";
import { RemoteAgent } from "@downcity/agent";
import { get_agent_registry_record, list_agent_registry_records, create_agent_registry_record, type AgentRegistryRecord } from "@downcity/agent-registry";
import type { SessionMessage } from "@downcity/agent";
import type { DesktopAgentSummary, DesktopChatMessage, DesktopChatResult, DesktopSessionSummary } from "../../common/types/DesktopApi.js";
import { resolve_running_agent_rpc_url } from "@/agent/AgentDaemonConnector.js";

const exec_file = promisify(execFile);

/** 桌面端 Agent 控制器。 */
export class AgentController {
  private readonly remote_agents = new Map<string, RemoteAgent>();

  /** 列出 CLI 与 Desktop 共用的 Agent 注册记录。 */
  list_agents(): DesktopAgentSummary[] {
    return list_agent_registry_records().map(to_desktop_agent_summary);
  }

  /** 创建一个共享注册的 Agent。 */
  create_agent(agent_id: string, workspace_path: string, model_id: string): DesktopAgentSummary {
    const normalized_model_id = String(model_id || "").trim();
    if (!normalized_model_id) throw new Error("model_id is required");
    return to_desktop_agent_summary(create_agent_registry_record({
      agent_id,
      workspace_path,
      version: "1.0.0",
      execution: { type: "api", model_id: normalized_model_id },
    }));
  }

  /** 连接已有 Agent daemon；未运行时通过 CLI 启动后再连接。 */
  async connect_agent(agent_id: string): Promise<string> {
    const config = get_agent_registry_record(agent_id);
    if (!config) throw new Error(`Agent not found: ${agent_id}`);

    const running_url = await resolve_running_agent_rpc_url(config);
    if (running_url) return await this.attach_remote_agent(agent_id, running_url);

    try {
      await exec_file("downcity", ["agent", "start", agent_id]);
    } catch (error) {
      // 并发启动或 CLI 已确认 daemon 在线时，连接运行实例而不是向 Renderer 抛错。
      const concurrent_url = await resolve_running_agent_rpc_url(config);
      if (concurrent_url) return await this.attach_remote_agent(agent_id, concurrent_url);
      throw new Error(format_agent_start_error(agent_id, error), { cause: error });
    }

    const started_url = await resolve_running_agent_rpc_url(config);
    if (!started_url) throw new Error(`Agent ${agent_id} daemon RPC identity is unavailable`);
    return await this.attach_remote_agent(agent_id, started_url);
  }

  /** 用已验证的 RPC 地址替换 Desktop 当前持有的远程连接。 */
  private async attach_remote_agent(agent_id: string, remote_url: string): Promise<string> {
    await this.remote_agents.get(agent_id)?.close();
    this.remote_agents.set(agent_id, new RemoteAgent({ url: remote_url }));
    return remote_url;
  }

  /** 列出一个运行中 Agent 的 Session。 */
  async list_sessions(agent_id: string): Promise<DesktopSessionSummary[]> {
    const remote_agent = this.require_remote_agent(agent_id);
    const page = await remote_agent.sessions.list();
    return page.items.map((session) => ({
      session_id: session.session_id,
      title: session.title || session.session_id,
    }));
  }

  /** 创建一个新的远程 Session。 */
  async create_session(agent_id: string): Promise<DesktopSessionSummary> {
    const session = await this.require_remote_agent(agent_id).sessions.create();
    return { session_id: session.id, title: "新会话" };
  }

  /** 读取一个远程 Session 的用户可见消息快照。 */
  async list_messages(agent_id: string, session_id: string): Promise<DesktopChatMessage[]> {
    const session = await this.require_remote_agent(agent_id).sessions.get(session_id);
    const page = await session.messages();
    return page.items
      .filter((message) => message.visibility === "visible")
      .map(to_desktop_chat_message)
      .filter((message): message is DesktopChatMessage => message !== null);
  }

  /** 发送聊天输入并等待当前 Turn 完成。 */
  async send_message(agent_id: string, session_id: string, text: string): Promise<DesktopChatResult> {
    const query = String(text || "").trim();
    if (!query) throw new Error("message is required");
    const session = await this.require_remote_agent(agent_id).sessions.get(session_id);
    const turn = await session.prompt({ query });
    const result = await turn.finished;
    return {
      session_id,
      text: result.text,
      success: result.success,
      ...(result.error ? { error: result.error } : {}),
    };
  }

  /** 获取已经启动并连接的 Agent。 */
  private require_remote_agent(agent_id: string): RemoteAgent {
    const remote_agent = this.remote_agents.get(agent_id);
    if (!remote_agent) throw new Error(`Agent ${agent_id} is not connected`);
    return remote_agent;
  }

  /** 释放 Desktop 持有的远程连接。 */
  async dispose(): Promise<void> {
    for (const remote_agent of this.remote_agents.values()) await remote_agent.close();
    this.remote_agents.clear();
  }
}

/**
 * 把 CLI 子进程异常转换为 Desktop 可直接展示的启动错误。
 *
 * CLI 的业务失败摘要输出到 stdout，而 Node warning 输出到 stderr；不能直接使用
 * `execFile` 的默认错误消息，否则 warning 会遮蔽真正的失败原因。
 */
function format_agent_start_error(agent_id: string, error: unknown): string {
  const stdout = clean_cli_error_output(read_process_output(error, "stdout"));
  const stderr = clean_cli_error_output(read_process_output(error, "stderr"));
  const outputs = [...new Set([stdout, stderr].filter(Boolean))];
  const detail = outputs.join("\n\n")
    || (error instanceof Error ? error.message : String(error));
  return `Agent ${agent_id} 启动失败\n${detail}`;
}

/** 从未知子进程异常中读取指定输出字段。 */
function read_process_output(error: unknown, field: "stdout" | "stderr"): string {
  if (!error || typeof error !== "object" || !(field in error)) return "";
  const value = Reflect.get(error, field);
  if (typeof value === "string") return value;
  return Buffer.isBuffer(value) ? value.toString("utf8") : "";
}

/** 清理不应作为业务错误展示的 CLI 装饰与 Node 实验性警告。 */
function clean_cli_error_output(output: string): string {
  return stripVTControlCharacters(output)
    .split(/\r?\n/u)
    .filter((line) => !/^downcity v\d/iu.test(line.trim()))
    .filter((line) => !/^\(node:\d+\) ExperimentalWarning:/u.test(line.trim()))
    .filter((line) => !/^\(Use `node --trace-warnings/u.test(line.trim()))
    .join("\n")
    .trim();
}

/** 把 Registry 记录收敛成 Renderer 所需的最小 Agent 摘要。 */
function to_desktop_agent_summary(record: AgentRegistryRecord): DesktopAgentSummary {
  const model_id = typeof record.execution?.model_id === "string"
    ? record.execution.model_id
    : "";
  return {
    agent_id: record.agent_id,
    workspace_path: record.workspace_path,
    model_id,
    version: record.version,
  };
}

/** 把 canonical Session Message 投影为当前 Desktop Chat 的纯文本展示模型。 */
function to_desktop_chat_message(message: SessionMessage): DesktopChatMessage | null {
  if (message.type === "user") {
    const text = message.parts
      .flatMap((part) => part.type === "text" && "text" in part ? [part.text] : [])
      .join("\n")
      .trim();
    return text ? { message_id: message.message_id, role: "user", text, created_at: message.created_at, pending: false } : null;
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
    return { message_id: message.message_id, role: "error", text: message.message, created_at: message.created_at, pending: false };
  }
  const text = [message.title, message.description].filter(Boolean).join("\n");
  return { message_id: message.message_id, role: "system", text, created_at: message.created_at, pending: message.status === "running" };
}
