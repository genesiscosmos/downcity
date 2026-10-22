/** MCP Power 的配置、工具与运行状态协议。 */

import type { PowerJsonObject, PowerJsonValue } from "@downcity/city/power";

/** MCP server 的稳定配置。 */
export interface McpServerConfig {
  /** server 稳定 ID，同时作为模型侧工具名前缀。 */
  id: string;
  /** 用户可见标题。 */
  title?: string;
  /** 是否启用该 server。 */
  enabled: boolean;
  /** server 传输配置。 */
  transport: McpStdioTransportConfig | McpHttpTransportConfig;
  /** 信任级别；不可信 server 的工具全部要求审批。 */
  trust: "trusted" | "untrusted";
  /** 单次工具调用超时时间，单位为毫秒。 */
  request_timeout_ms: number;
  /** 空闲连接关闭时间，单位为毫秒；零表示不自动关闭。 */
  idle_timeout_ms: number;
  /** 返回给模型的最大字符数。 */
  max_result_chars: number;
  /** 不投影的 MCP 原始工具名。 */
  disabled_tools?: string[];
  /** 是否把媒体结果写入 Power 消息。 */
  attach_media: boolean;
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
export interface McpHttpTransportConfig {
  /** 传输类型。 */
  type: "http";
  /** MCP endpoint URL。 */
  url: string;
  /** 追加到请求的 HTTP headers。 */
  headers?: Record<string, string>;
}

/** MCP Power 持久化配置。 */
export interface McpPowerConfig {
  /** 已配置的 server 列表。 */
  servers: McpServerConfig[];
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
  /** 最近一次错误。 */
  last_error?: string;
  /** 最近一次成功更新时间。 */
  updated_at?: string;
}

/** MCP 状态动作返回值。 */
export interface McpStatusResult {
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
