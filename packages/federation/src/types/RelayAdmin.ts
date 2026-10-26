/** 中转管理员安全元数据；不包含环境变量值、Provider 配置或模型执行函数。 */
export interface RelayAdminTemplate {
  /** 已注册语言模型的模板 ID。 */
  id: string;
  /** 模板展示名称。 */
  name: string;
  /** registered runtime 固定所属渠道 ID。 */
  channel_id: string;
  /** registered runtime 固定上游映射。 */
  upstream_model: string;
}
export interface RelayAdminMetadata {
  /** SDK 支持的适配器 ID，表单从此列表选择。 */
  adapters: string[];
  /** 当前服务已注册语言模板和 runtime 的安全投影。 */
  templates: RelayAdminTemplate[];
}
export interface RelayAdminDeploymentHealth {
  /** 当前目录部署 ID。 */
  deployment_id: string;
  /** 所属渠道 ID。 */
  channel_id: string;
  /** 当前配置是否启用该部署及其模型和渠道。 */
  enabled: boolean;
  /** 共享数据库中记录的截止 Unix 毫秒；没有记录时为 null。 */
  cooldown_until: number | null;
  /** 仅表示是否正在冷却，不表示上游探测成功。 */
  cooling: boolean;
}
export interface RelayAdminHealth {
  /** 服务端采样 Unix 毫秒，用于解释冷却状态。 */
  checked_at: number;
  /** 当前目录部署的共享冷却投影。 */
  items: RelayAdminDeploymentHealth[];
}
