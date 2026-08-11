/**
 * Desktop Agent 控制器。
 *
 * 负责把共享 Registry 和 Downcity CLI daemon 连接起来；Renderer 不直接接触
 * 文件系统、子进程或 Agent SDK。
 */
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { RemoteAgent } from "@downcity/agent";
import { get_agent_registry_root_path, list_agent_registry_records, create_agent_registry_record, type AgentRegistryRecord } from "@downcity/agent-registry";
import type { DesktopChatResult, DesktopSessionSummary } from "../../common/types/DesktopApi.js";

const exec_file = promisify(execFile);

/** 桌面端 Agent 控制器。 */
export class AgentController {
  private readonly remote_agents = new Map<string, RemoteAgent>();

  /** 列出 CLI 与 Desktop 共用的 Agent 注册记录。 */
  list_agents(): AgentRegistryRecord[] { return list_agent_registry_records(); }

  /** 创建一个共享注册的 Agent。 */
  create_agent(agent_id: string, workspace_path: string, model_id: string): AgentRegistryRecord {
    const normalized_model_id = String(model_id || "").trim();
    if (!normalized_model_id) throw new Error("model_id is required");
    return create_agent_registry_record({
      agent_id,
      workspace_path,
      version: "1.0.0",
      execution: { type: "api", model_id: normalized_model_id },
    });
  }

  /** 启动指定 Agent 的 CLI daemon，并返回本机 RPC 地址。 */
  async start_agent(agent_id: string): Promise<string> {
    await exec_file("downcity", ["agent", "start", agent_id]);
    const daemon_path = path.join(get_agent_registry_root_path(), "runtimes", agent_id, "daemon.json");
    const daemon = JSON.parse(await fs.readFile(daemon_path, "utf8")) as { args?: unknown };
    const args = Array.isArray(daemon.args) ? daemon.args.map(String) : [];
    const port_index = args.indexOf("--rpc-port");
    const rpc_port = Number(args[port_index + 1]);
    if (!Number.isInteger(rpc_port) || rpc_port <= 0 || rpc_port > 65535) {
      throw new Error(`Agent ${agent_id} daemon RPC port is unavailable`);
    }
    const remote_url = `rpc://127.0.0.1:${rpc_port}`;
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
