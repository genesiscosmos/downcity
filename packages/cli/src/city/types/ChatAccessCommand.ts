/**
 * Chat Access CLI 类型。
 *
 * 关键点（中文）
 * - 命令目标必须解析为一个已登记 Agent，不能把任意当前目录当作存储位置。
 * - Commander 的公开选项字段保持命令行约定，业务实现内部统一使用 snake_case。
 */

import type { ManagedAgent } from "@/city/types/agent/ManagedAgent.js";

/** Chat Access 命令共享选项。 */
export interface ChatAccessCommandOptions {
  /** 明确指定的 Agent ID。 */
  agent?: string;
  /** 明确指定的 Agent 项目根目录。 */
  path?: string;
  /** 是否输出结构化 JSON。 */
  json?: boolean;
}

/** 请求列表命令选项。 */
export interface ChatAccessRequestsOptions extends ChatAccessCommandOptions {
  /** Access Request 状态过滤条件。 */
  status?: "pending" | "approved" | "denied" | "expired";
}

/** 请求处理命令选项。 */
export interface ChatAccessResolveOptions extends ChatAccessCommandOptions {
  /** 覆盖请求自身范围的管理范围。 */
  scope?: "direct" | "group" | "all";
}

/** 主体 Grant 设置命令选项。 */
export interface ChatAccessSetOptions extends ChatAccessCommandOptions {
  /** 要设置的 Chat 消息范围。 */
  scope: "direct" | "group" | "all";
  /** 要写入的准入效果。 */
  effect: "allow" | "deny";
}

/** 主体 Grant 撤销命令选项。 */
export interface ChatAccessRevokeOptions extends ChatAccessCommandOptions {
  /** 要撤销的 Chat 消息范围。 */
  scope: "direct" | "group" | "all";
}

/** 已解析的 Chat Access Agent 目标。 */
export interface ChatAccessTarget {
  /** Agent 稳定 ID。 */
  agent_id: string;
  /** Agent 项目根目录绝对路径。 */
  project_root: string;
  /** City 全局配置库中的 Agent 配置。 */
  config: ManagedAgent;
}
