/** Session 模型事实，独立保存创建默认值与用户显式覆盖；不从展示 label 推断 ID。 */
export interface SessionModelBinding {
  /** 创建时捕获的默认模型 ID；null 表示当时明确未配置，旧历史无此记录时整个 binding 缺省。 */
  default_model_id: string | null;
  /** 创建时模型捕获的不透明、非秘密授权来源；缺省代表未记录，禁止从当前账户补全。 */
  default_binding_id?: string;
  /** 显式 session.set 模型覆盖；不存在时恢复创建快照，不能读取当前 Agent 默认值。 */
  override_model_id?: string;
  /** 用户显式覆盖模型时确认的授权来源；仅与 override_model_id 配对，不能继承默认来源。 */
  override_binding_id?: string;
}
