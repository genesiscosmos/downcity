/**
 * `city agent` 交互式 manager 类型。
 */

export interface AgentManagerAgentSummary {
  /** Agent 的稳定全局 ID。 */
  id: string;
  /** Agent 持久化绑定的 Workspace。 */
  project_root?: string;
  /** Agent 配置中的默认模型 ID。 */
  execution_binding?: string;
}
