/** Session 模型事实，独立保存创建默认值与用户显式覆盖；不从展示 label 推断 ID。 */
export interface SessionModelBinding {
  /** 创建时捕获的默认模型 ID；null 表示当时明确未配置，旧历史无此记录时整个 binding 缺省。 */
  default_model_id: string | null;
  /** 显式 session.set 模型覆盖；不存在时恢复创建快照，不能读取当前 Agent 默认值。 */
  override_model_id?: string;
}
