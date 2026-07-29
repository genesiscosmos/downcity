/**
 * City Env 运行时广播类型。
 */

/** Env 文件变更后的 Agent 广播结果。 */
export interface EnvBroadcastResult {
  /** 已在线重新加载 Env 的 Agent ID。 */
  updated_agent_ids: string[];
  /** 当前未运行、将在下次启动时加载 Env 的 Agent ID。 */
  stopped_agent_ids: string[];
  /** 在线同步失败的 Agent 与错误原因。 */
  failed_agents: Array<{
    /** 同步失败的 Agent ID。 */
    agent_id: string;
    /** RPC 同步失败原因。 */
    error: string;
  }>;
}
