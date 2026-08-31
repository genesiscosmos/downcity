/**
 * Downcity 模型 usage 协议模块。
 *
 * Provider Adapter 负责把厂商计量字段映射为累计 token 数，核心运行时不猜测缺失值。
 */

/** 单次模型 step 的标准累计 usage。 */
export interface ModelUsage {
  /** 输入 token 数量。 */
  input_tokens: number;
  /** 输出 token 数量。 */
  output_tokens: number;
  /** 输入与输出 token 总数。 */
  total_tokens: number;
  /** 输入缓存命中 token 数量。 */
  cached_input_tokens?: number;
  /** 输入缓存写入 token 数量。 */
  cache_write_tokens?: number;
  /** 输出中的推理 token 数量。 */
  reasoning_tokens?: number;
}
