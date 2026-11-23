/**
 * City HTTP 宿主运行时能力类型。
 *
 * City transport 先按 Agent ID 选中 Agent，再把模型解析等宿主能力投影给单
 * Agent HTTP router，避免路由层理解本地 Store 的实现。
 */

import type { AgentSessionModelResolver } from "@/city/transport/types/AgentSessionModelResolver.js";
import type { Agent } from "@downcity/agent";
import type { AgentPowerRuntime } from "@/power/types/PowerExecutionRuntime.js";
import type { WorkspaceRuntime } from "@/workspace/index.js";
import type { Hono } from "hono";
import type { ModelReference } from "@downcity/type";

/** 宿主为一个 Agent 提供的 HTTP 扩展。 */
export interface CityAgentHttpExtension {
  /** 已组合 SDK Router 的 Agent 子路由。 */
  router: Hono;

  /** CityHTTP 关闭时需要同步释放的宿主资源。 */
  dispose?(): void | Promise<void>;
}

/** City HTTP transport 所需的宿主能力。 */
export interface CityHttpRuntimeOptions {
  /**
   * 客户端使用的显式 City HTTP/HTTPS 根地址，可包含反向代理保留的路径前缀。
   * 例如 https://city.example.com；与本机监听地址独立，不创建 Tunnel、证书或 DNS。
   * 配置此字段时必须提供 authorize_agent；禁止从 Host 或 Forwarded 请求头推断。
   * 未配置时仅使用实际非通配监听地址；该地址是否能被另一台设备访问由宿主负责。
   */
  public_url?: string;
  /**
   * 允许跨域访问 City HTTP 的精确 HTTP/HTTPS Origin 列表，例如 https://remote.downcity.ai。
   * 省略时不启用 CORS；传空列表时拒绝跨域来源。禁止通配符、路径和内嵌凭据。
   * 预检只允许 GET、POST、OPTIONS 及 Authorization、Content-Type，不替代 Agent 授权。
   */
  allowed_origins?: readonly string[];
  /** 为 Agent 发现及无 Workspace SDK 路由校验凭据；宿主提供时未授权 Agent 不可见。 */
  authorize_agent?: (input: {
    /** 待访问的 Agent。 */ readonly agent: Agent;
    /** 原始请求，供宿主使用现有认证策略。 */ readonly request: Request;
  }) => boolean | Promise<boolean>;
  /** 为指定 Agent 创建远程 Session 所需的模型解析器。 */
  resolve_session_model?: (input: {
    /** 当前请求已经解析出的 Agent 实例。 */
    readonly agent: Agent;
    /** 当前请求已经进入的 Workspace 实例。 */
    readonly workspace: WorkspaceRuntime;
    /** 远程 Session 请求指定的结构化模型引用。 */
    readonly model: ModelReference;
  }) => ReturnType<AgentSessionModelResolver>;

  /** 为一个 Agent 组合 Auth、控制台和应用专属路由。 */
  create_agent_extension?: (input: {
    /** 当前路由对应的本地 Agent。 */
    agent: Agent;
    /** 当前路由对应的 Agent Workspace 执行作用域。 */
    workspace: WorkspaceRuntime;
    powers: AgentPowerRuntime;
    /** City 提供的标准 RemoteAgent SDK Router。 */
    sdk_router: Hono;
  }) => CityAgentHttpExtension;

  /**
   * 显式挂载到 City HTTP 根路径的宿主扩展 Router。
   * 不经过 Agent 授权回调；宿主必须为需要保护的路由配置自己的鉴权。
   * 不应在可经 Tunnel/公网访问的监听上挂载本机管理或未授权的内部接口。
   */
  city_router?: Hono;
}
