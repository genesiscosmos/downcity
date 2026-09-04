/** 串行 transport 生命周期内部类型。 */

/** 启动 transport 后由生命周期对象持有的资源和 binding。 */
export interface SerializedTransportStartResult<TResource, TBinding> {
  /** 本次启动创建、关闭时需要释放的底层资源。 */
  resource: TResource;

  /** 对调用方可见的监听地址快照。 */
  binding: TBinding;
}

/** 串行 transport 生命周期的依赖。 */
export interface SerializedTransportOptions<TOptions, TResource, TBinding> {
  /** 根据监听参数创建并启动底层资源。 */
  start(options: TOptions): Promise<SerializedTransportStartResult<TResource, TBinding>>;

  /** 释放一个已经成功启动的底层资源。 */
  stop(resource: TResource): Promise<void>;
}
