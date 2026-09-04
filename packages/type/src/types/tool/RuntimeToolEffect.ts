/**
 * Runtime Tool 的 Turn 副作用协议。
 *
 * Tool 通过该协议报告已经发生、但不应作为模型输出返回的结构化事实。
 * 宿主只负责在当前 Turn 内收集；具体业务含义由对应领域投影器解释。
 */

/** 一次 Tool 执行已经产生的结构化副作用。 */
export interface RuntimeToolEffect<TData = unknown> {
  /** 命名空间化的副作用类型，由产生该副作用的领域定义。 */
  readonly type: string;

  /** 副作用携带的领域数据；消费方必须按 type 完成运行时校验。 */
  readonly data: TData;
}
