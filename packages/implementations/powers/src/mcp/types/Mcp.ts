/** SkillPower 内部 MCP 服务的配置、工具与运行状态协议。 */

import type { PowerJsonObject, PowerJsonValue } from "@downcity/city/power";
import type { McpOAuthTransportConfig, McpOAuthState } from "../auth/OAuthTypes.js";

/** MCP server 的稳定配置。 */
export interface McpServerConfig {
  /** server 稳定 ID，来自独立 TOML 文件名。 */
  id: string;
  /** 用户可见标题。 */
  title?: string;
  /** 是否启用该 server。 */
  enabled: boolean;
  /** server 传输配置。 */
  transport: McpStdioTransportConfig | McpHttpTransportConfig;
  /** 单次工具调用超时时间，单位为毫秒。 */
  request_timeout_ms: number;
  /** 返回给模型的最大字符数。 */
  max_result_chars: number;
}

/** MCP stdio 传输配置。 */
export interface McpStdioTransportConfig {
  /** 传输类型。 */
  type: "stdio";
  /** 要启动的可执行命令。 */
  command: string;
  /** 传给命令的参数。 */
  args?: string[];
  /** 追加到子进程的环境变量。 */
  env?: Record<string, string>;
  /** 子进程工作目录。 */
  cwd?: string;
}

/** MCP Streamable HTTP 传输配置。 */
export interface McpHttpTransportConfig extends McpOAuthTransportConfig {
  /** 传输类型。 */
  type: "http";
  /** MCP endpoint URL。 */
  url: string;
  /** 追加到请求的 HTTP headers。 */
  headers?: Record<string, string>;
}

/** MCP 工具的 JSON Schema 描述。 */
export interface McpToolDefinition {
  /** MCP 原始工具名。 */
  name: string;
  /** MCP 工具说明。 */
  description?: string;
  /** MCP 输入 JSON Schema。 */
  inputSchema: PowerJsonObject;
  /** MCP 工具注解。 */
  annotations?: {
    /** server 声明工具只读。 */
    readOnlyHint?: boolean;
    /** 其他未使用的 MCP 注解。 */
    [key: string]: PowerJsonValue | undefined;
  };
  /** MCP 输出 JSON Schema。 */
  outputSchema?: PowerJsonObject;
}

/** 单个 server 的连接状态。 */
export interface McpServerStatus {
  /** server 稳定 ID。 */
  id: string;
  /** 当前 server 状态。 */
  state: "disabled" | "idle" | "ready" | "error";
  /** 当前可调用工具数量。 */
  tool_count: number;
  /** Non-secret OAuth state; omitted for local stdio servers. */
  auth_state?: McpOAuthState;
  /** HTTP servers support explicit reauthorization. */
  can_authorize?: boolean;
  /** 最近一次错误。 */
  last_error?: string;
  /** 最近一次成功更新时间。 */
  updated_at?: string;
}

/** MCP 状态动作返回值。 */
export interface McpStatusResult {
  /** 宿主实际使用的全局 Server 定义目录。 */
  directory: string;
  /** 每个 server 的状态。 */
  servers: McpServerStatus[];
}

/** MCP 工具调用结果。 */
export interface McpCallResult {
  /** MCP 是否将调用标记为错误。 */
  isError?: boolean;
  /** 非结构化结果内容。 */
  content?: Array<Record<string, PowerJsonValue>>;
  /** 结构化工具结果。 */
  structuredContent?: PowerJsonValue;
  /** MCP 交互式输入请求标记。 */
  resultType?: string;
}
