/** Agent 定义中的 Plugin 引用。 */

/** 一个 Agent 已注册的 Plugin。 */
export interface AgentPluginReference {
  /** 目标 Agent 的稳定 ID。 */
  agent_id: string;
  /** Plugin 的全局稳定 ID。 */
  plugin_id: string;
  /** Plugin 配置目录中选中的 profile。 */
  profile?: string;
}

/** 注册或切换 Agent Plugin profile 的输入。 */
export interface SetAgentPluginReferenceInput {
  /** 目标 Agent 的稳定 ID。 */
  agent_id: string;
  /** Plugin 的全局稳定 ID。 */
  plugin_id: string;
  /** Plugin 配置目录中选中的 profile。 */
  profile?: string;
}
