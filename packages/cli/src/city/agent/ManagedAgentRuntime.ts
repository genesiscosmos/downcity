/**
 * ManagedAgentRuntime：单个受管 Agent 的运行组合根。
 *
 * 职责（中文）
 * - 从全局 Managed Agent 配置构建模型、Plugin、Sandbox、Workspace 与 Agent。
 * - 统一启动本机 RPC 和受鉴权保护的 HTTP Gateway。
 * - 以幂等顺序释放 Gateway、RPC 与 Agent，避免调用方重复管理内部资源。
 */

import path from "node:path";
import { Agent, City } from "@downcity/agent";
import { AgentHTTP, AgentRPC } from "@downcity/server";
import { create_platform_agent } from "@/agent-host/index.js";
import { startAgentHttpGateway } from "@/city/agent/AgentHttpGateway.js";
import { get_managed_agent } from "@/city/process/registry/ManagedAgentRepository.js";
import { get_workspace_by_path } from "@/city/process/registry/WorkspaceRepository.js";
import type { CreateManagedAgentRuntimeInput } from "@/city/types/agent/ManagedAgentRuntime.js";
import { CliError } from "@/shared/CliError.js";

/** 解析并校验 TCP 端口。 */
function parse_port(
  value: string | number | undefined,
  label: string,
): number | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const port = typeof value === "number"
    ? value
    : Number.parseInt(String(value), 10);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error(`${label} must be an integer between 1 and 65535`);
  }
  return port;
}

/** 已启动的受管 Agent Runtime；所有内部资源只能由该对象统一释放。 */
export class ManagedAgentRuntime {
  /** Agent SDK 实例。 */
  readonly agent: Agent;

  /** 当前进程拥有的 City 容器。 */
  readonly city: City;

  private readonly rpc: AgentRPC;
  private readonly gateway: Awaited<ReturnType<typeof startAgentHttpGateway>>;
  private stopped = false;

  private constructor(input: {
    agent: Agent;
    city: City;
    rpc: AgentRPC;
    gateway: Awaited<ReturnType<typeof startAgentHttpGateway>>;
  }) {
    this.agent = input.agent;
    this.city = input.city;
    this.rpc = input.rpc;
    this.gateway = input.gateway;
  }

  /** 按依赖逆序幂等停止整个 Runtime。 */
  async stop(): Promise<void> {
    if (this.stopped) return;
    this.stopped = true;
    await this.gateway.stop();
    await this.rpc.close();
    await this.city.dispose();
  }

  /** 读取 Agent 日志器，供进程入口输出生命周期日志。 */
  get_logger(): ReturnType<Agent["get_logger"]> {
    return this.agent.get_logger();
  }

  /** 创建全部依赖并完成 RPC、HTTP 两个 transport 的启动。 */
  static async start(
    input: CreateManagedAgentRuntimeInput,
  ): Promise<ManagedAgentRuntime> {
    const config = get_managed_agent(input.target.agent_id);
    const workspace_path = path.resolve(input.target.workspace_path);
    const workspace_record = get_workspace_by_path(workspace_path);
    if (!config || !workspace_record) {
      throw new CliError({
        title: "Agent or Workspace is not registered",
        note: `${input.target.agent_id} → ${workspace_path}`,
        fix: "city agent list",
      });
    }

    let port: number;
    let rpc_port: number;
    try {
      port = parse_port(input.options.port, "port") ?? config.start?.port ?? 5314;
      rpc_port = parse_port(input.options.rpcPort, "rpcPort") ?? 15314;
    } catch (error) {
      throw new CliError({
        title: "Invalid start options",
        note: error instanceof Error ? error.message : String(error),
      });
    }
    if (port === rpc_port) {
      throw new CliError({
        title: "Invalid start options",
        note: "port and rpcPort must be different",
      });
    }

    const host = String(input.options.host ?? config.start?.host ?? "127.0.0.1").trim();
    const rpc_host = "127.0.0.1";
    const native_runtime = await create_platform_agent({
      agent_id: input.target.agent_id,
      workspace_path,
      host,
      port,
    });
    const agent = native_runtime.agent;
    const city = new City([agent]);

    process.env.DC_BAY_PORT = String(port);
    process.env.DC_BAY_HOST = host;
    process.env.DC_AGENT_RPC_PORT = String(rpc_port);
    process.env.DC_AGENT_RPC_HOST = rpc_host;
    process.env.DC_AGENT_ID = input.target.agent_id;
    process.env.DC_AGENT_PATH = workspace_path;

    const resolve_session_model = native_runtime.create_session_model;
    const rpc = new AgentRPC(agent, {
      resolve_session_model,
      reload_workspace_env: native_runtime.reload_workspace_env,
    });
    await rpc.listen({ host: rpc_host, port: rpc_port });
    try {
      const agent_http = new AgentHTTP(agent, {
        resolve_session_model,
      });
      const gateway = await startAgentHttpGateway({
        host,
        port,
        get_agent: () => agent,
        sdkRouter: agent_http.router(),
      });
      return new ManagedAgentRuntime({ agent, city, rpc, gateway });
    } catch (error) {
      await rpc.close();
      await city.dispose();
      throw error;
    }
  }
}

/** 创建并启动一个受管 Agent Runtime。 */
export async function create_managed_agent_runtime(
  input: CreateManagedAgentRuntimeInput,
): Promise<ManagedAgentRuntime> {
  return ManagedAgentRuntime.start(input);
}
