/**
 * 按稳定 ID 惰性恢复模型客户端。
 *
 * 浏览和句柄恢复不解析模型；执行输入组装显式等待完整客户端，让 Composer、
 * 请求预算和实际请求共享同一份模型元信息。解析成功复用实例，失败允许后续重试。
 */
import type { ModelCall, ModelClient, ModelStreamEvent } from "@downcity/type";

/** SDK 内部的模型占位句柄；不以当前默认模型的元信息代替已保存模型。 */
export class DeferredModelClient implements ModelClient {
  /** Session 持久化的稳定模型 ID。 */
  readonly id: string;
  /** 宿主提供的模型解析函数，只在执行需要完整客户端时调用。 */
  private readonly resolve_client: () => Promise<ModelClient>;
  /** 同一占位句柄共享的解析任务，拒绝后清空以允许重试。 */
  private pending_client?: Promise<ModelClient>;
  /** 已核实 ID 的客户端，也用于提供恢复后的只读元信息。 */
  private resolved_client?: ModelClient;

  constructor(model_id: string, resolve_client: () => Promise<ModelClient>) {
    this.id = model_id;
    this.resolve_client = resolve_client;
  }

  /** 解析完成后暴露真实名称；浏览阶段保持未解析。 */
  get name(): string | undefined { return this.resolved_client?.name; }

  /** 解析完成后暴露真实窗口，未解析时不猜测窗口大小。 */
  get context_window(): number | undefined { return this.resolved_client?.context_window; }

  /** 解析一次并核对宿主没有将保存的 ID 替换为其他默认模型。 */
  async resolve(): Promise<ModelClient> {
    this.pending_client ??= Promise.resolve().then(this.resolve_client).then((client) => {
      if (client.id !== this.id || client === this) throw new Error(`Host resolved a different Session model: ${this.id}`);
      this.resolved_client = client;
      return client;
    }).catch((error) => { this.pending_client = undefined; throw error; });
    return await this.pending_client;
  }

  /** 保留 ModelClient 标准流入口，直接调用也复用同一个解析结果。 */
  async stream(call: ModelCall, signal?: AbortSignal): Promise<ReadableStream<ModelStreamEvent>> {
    return await (await this.resolve()).stream(call, signal);
  }
}

/** 执行边界逐层解析宿主与历史恢复的占位句柄，确保预算取得真实模型元数据。 */
export async function resolve_model_client(model: ModelClient | undefined): Promise<ModelClient | undefined> {
  const visited = new Set<ModelClient>();
  let current = model;
  while (current instanceof DeferredModelClient) {
    if (visited.has(current)) throw new Error(`Circular deferred Session model: ${current.id}`);
    visited.add(current);
    const resolved = await current.resolve();
    if (resolved.id !== current.id) throw new Error(`Host resolved a different Session model: ${current.id}`);
    current = resolved;
  }
  return current;
}
