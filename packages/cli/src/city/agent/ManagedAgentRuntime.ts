/**
 * ManagedAgentRuntime：单个受管 Agent 的运行组合根。
 *
 * 职责（中文）
 * - 从全局 Managed Agent 配置构建模型、Plugin、Sandbox、Workspace 与 Agent。
 * - 统一启动本机 RPC 和受鉴权保护的 HTTP Gateway。
 * - 以幂等顺序释放 Gateway、RPC 与 Agent，避免调用方重复管理内部资源。
 */

import path from "node:path";
import { Agent, Workspace } from "@downcity/agent";
import { AskQuestionsTool } from "@downcity/agent/tools";
import { Shell } from "@downcity/shell";
import { AgentHTTP, AgentRPC } from "@downcity/server";
import { startAgentHttpGateway } from "@/city/agent/AgentHttpGateway.js";
import { createRuntimeModel } from "@/city/runtime/city-model/CreateRuntimeModel.js";
import { createCityAiAgentModel } from "@/city/runtime/city-model/CityAiServiceBinding.js";
import { assemble_plugins } from "@/city/runtime/plugins/PluginAssembler.js";
import { resolve_managed_agent_env } from "@/city/env/ProcessEnv.js";
import { get_managed_agent } from "@/city/process/registry/ManagedAgentRepository.js";
import {
  list_agent_plugin_bindings,
} from "@/city/process/registry/PluginRepository.js";
import { create_platform_sandbox } from "@/city/sandbox/PlatformSandbox.js";
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

  private readonly rpc: AgentRPC;
  private readonly gateway: Awaited<ReturnType<typeof startAgentHttpGateway>>;
  private stopped = false;

  private constructor(input: {
    agent: Agent;
    rpc: AgentRPC;
    gateway: Awaited<ReturnType<typeof startAgentHttpGateway>>;
  }) {
    this.agent = input.agent;
    this.rpc = input.rpc;
    this.gateway = input.gateway;
  }

  /** 按依赖逆序幂等停止整个 Runtime。 */
  async stop(): Promise<void> {
    if (this.stopped) return;
    this.stopped = true;
    await this.gateway.stop();
    await this.rpc.close();
    await this.agent.dispose();
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
    if (!config || path.resolve(config.workspace_path) !== workspace_path) {
      throw new CliError({
        title: "Agent target is not managed",
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
    const env = resolve_managed_agent_env(workspace_path);
    const plugin_bindings = list_agent_plugin_bindings(config.agent_id);
    const [model, plugins, sandbox] = await Promise.all([
      createRuntimeModel({ config, env }),
      assemble_plugins({
        bindings: plugin_bindings,
        context: { env, host, port },
      }),
      create_platform_sandbox(),
    ]);
    const workspace = new Workspace({
      path: workspace_path,
      shell: new Shell({ sandbox }),
      env,
    });
    const agent = new Agent({
      id: input.target.agent_id,
      workspace,
      model,
      plugins,
      tools: {
        ask_question: AskQuestionsTool,
      },
    });

    process.env.DC_BAY_PORT = String(port);
    process.env.DC_BAY_HOST = host;
    process.env.DC_AGENT_RPC_PORT = String(rpc_port);
    process.env.DC_AGENT_RPC_HOST = rpc_host;
    process.env.DC_AGENT_ID = input.target.agent_id;
    process.env.DC_AGENT_PATH = workspace_path;

    await agent.ready();
    const resolve_session_model = async (model_id: string) => await createCityAiAgentModel({
      modelId: model_id,
      env,
    });
    const rpc = new AgentRPC(agent, {
      resolve_session_model,
      reload_workspace_env: () => {
        const next_env = resolve_managed_agent_env(workspace_path);
        workspace.set_env(next_env);
        return next_env;
      },
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
      return new ManagedAgentRuntime({ agent, rpc, gateway });
    } catch (error) {
      await rpc.close();
      await agent.dispose();
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
