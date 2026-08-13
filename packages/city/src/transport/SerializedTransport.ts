/**
 * 串行 transport 生命周期。
 *
 * 该对象是 HTTP/RPC Server 状态的唯一拥有者。listen 与 close 按调用顺序执行，
 * 因此启动过程中收到 close 时，会先完成启动再立即释放，不会留下失联端口。
 */

import type { SerializedTransportOptions } from "@/types/SerializedTransport.js";

/** 管理一个可重复监听和关闭的底层 transport。 */
export class SerializedTransport<TOptions, TResource, TBinding> {
  /** transport 操作的唯一串行链。 */
  private operation_chain: Promise<void> = Promise.resolve();

  /** 当前已经成功启动的底层资源。 */
  private current_resource: TResource | null = null;

  /** 当前监听地址；未监听时为空。 */
  private current_binding: TBinding | null = null;

  constructor(
    /** 创建和释放底层资源的实现。 */
    private readonly options: SerializedTransportOptions<TOptions, TResource, TBinding>,
  ) {}

  /** 按调用顺序启动 transport；已监听时返回现有 binding。 */
  async listen(options: TOptions): Promise<TBinding> {
    return await this.enqueue(async () => {
      if (this.current_binding) return this.current_binding;
      const started = await this.options.start(options);
      this.current_resource = started.resource;
      this.current_binding = started.binding;
      return started.binding;
    });
  }

  /** 按调用顺序关闭 transport；没有监听时直接完成。 */
  async close(): Promise<void> {
    await this.enqueue(async () => {
      const resource = this.current_resource;
      if (!resource) return;
      await this.options.stop(resource);
      // 释放成功后才提交 stopped 状态；失败时保留句柄，允许调用方重试收口。
      if (this.current_resource === resource) {
        this.current_resource = null;
        this.current_binding = null;
      }
    });
  }

  /** 返回当前已完成监听的 binding 快照。 */
  binding(): TBinding | null {
    return this.current_binding;
  }

  /** 将一次状态变化接到唯一操作链，并保证失败后后续操作仍可继续。 */
  private enqueue<TResult>(operation: () => Promise<TResult>): Promise<TResult> {
    const result = this.operation_chain.then(operation);
    this.operation_chain = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
}
