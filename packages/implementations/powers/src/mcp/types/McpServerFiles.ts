/**
 * MCP 独立定义文件协议。
 *
 * 文件名是 Server ID；原文只通过 Desktop 配置管理通道返回，Agent 状态与工具动作
 * 不携带 env、headers 或 TOML 原文，避免凭据进入模型上下文。
 */

import type { McpServerConfig, McpServerStatus, McpToolDefinition } from "./Mcp.js";

/** 单个定义文件的编辑快照，包括无法解析的原文。 */
export interface McpServerFile {
  /** 文件名去除 .toml 后的稳定 Server ID。 */
  id: string;
  /** 宿主上的真实绝对文件路径。 */
  path: string;
  /** 文件的完整原文，用于编辑和保存冲突检查。 */
  content: string;
  /** 读取、解析或校验错误；只影响该文件。 */
  error?: string;
}

/** Desktop 配置页读取的目录快照。 */
export interface McpServerFilesView {
  /** 当前宿主实际使用的全局 Server 目录。 */
  directory: string;
  /** 按文件名排序的独立 Server 文件。 */
  servers: McpServerFile[];
}

/** 校验后的扫描结果，不属于模型侧协议。 */
export interface McpServerFileScan extends McpServerFilesView {
  /** 通过校验的定义；错误文件保留在 servers 中供修复。 */
  configs: McpServerConfig[];
}

/** 单个 Server 的连接缓存，由 SkillPower 持有的 MCP runtime 管理生命周期。 */
export interface McpServerRuntime {
  /** 当前有效且已归一化的 Server 定义。 */
  config: McpServerConfig;
  /** 惰性创建的 MCP 连接。 */
  connection?: import("../runtime/Transport.js").McpConnection;
  /** 最近发现的工具清单。 */
  tools: McpToolDefinition[];
  /** 无凭据的运行状态。 */
  status: McpServerStatus;
}
