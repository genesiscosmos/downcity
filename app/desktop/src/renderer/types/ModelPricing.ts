/** Desktop 模型价格图使用的结构化视图模型。 */

/** 单个模型的输入与输出 token 价格。 */
export interface ModelPricingPoint {
  /** 模型稳定标识。 */
  model_id: string;
  /** 模型展示名称。 */
  model_name: string;
  /** 每 1M tokens 的输入美元价格。 */
  input_usd_per_1m: number;
  /** 每 1M tokens 的输出美元价格。 */
  output_usd_per_1m: number;
}
