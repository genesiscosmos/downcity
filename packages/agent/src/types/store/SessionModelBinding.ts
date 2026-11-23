/** Session 当前模型事实；模型来源与服务端 ID 作为一个结构化值保存。 */
export interface SessionModelBinding {
  /** Town 中 Downtown 的稳定标识与该服务提供的原始模型 ID。 */
  model?: import("@downcity/type").DowntownModelReference;
}
