/**
 * City Agent 环境容器类型。
 *
 * City 只拥有已实例化 Agent 的集合与释放策略，不负责 Registry、Workspace 选择、
 * 模型构建或进程生命周期。
 */

import type { Agent } from "@/agent/Agent.js";

/** City 构造参数。 */
export interface CityOptions {
  /** City 初始拥有的 Agent 实例。 */
  agents?: Iterable<Agent>;
}

/** 从 City 移除 Agent 的选项。 */
export interface CityRemoveAgentOptions {
  /** 是否同时释放 Agent；默认释放。 */
  dispose?: boolean;
}
