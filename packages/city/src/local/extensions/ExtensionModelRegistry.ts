/**
 * 扩展文本模型注册及稳定惰性句柄。目录代次独立于 Federation 登录代次，
 * 删除后保留 ID 解析失败，不隐式回退到其他模型。
 */
import { createHash } from "node:crypto";
import type { ModelClient, ModelCall, ModelStreamEvent } from "@downcity/type";
import { ExtensionGate, track_extension_stream } from "./ExtensionGate.js";
import { ExtensionFailure } from "./ExtensionError.js";

/** 一份宿主统一持有的扩展模型目录。 */
export class ExtensionModelRegistry {
  private readonly models = new Map<string, ModelClient>();
  private generation_value = 0;

  /** 模型装卸的独立代次，不受全局 Federation 影响。 */
  get generation(): number { return this.generation_value; }

  /** 注册薄适配，保持 source.id 只读且不被改写。 */
  register(id: string, source: ModelClient, gate: ExtensionGate): ModelClient {
    if (this.models.has(id)) throw new ExtensionFailure("duplicate_id", "Model ID is already registered", "load", 2);
    const model: ModelClient = {
      id, name: source.name ?? source.id, context_window: source.context_window, model_stream_policy: source.model_stream_policy,
      async stream(call, signal) {
        const release = gate.acquire(`model:${id}`);
        try { return track_extension_stream(await source.stream(call, signal), release, signal); }
        catch (error) { release(); throw error; }
      },
    };
    this.models.set(id, model);
    this.generation_value++;
    return model;
  }

  /** 原子发布前由运行层处理校验，本操作不释放项目拥有的原始实例。 */
  remove(id: string): void { if (this.models.delete(id)) this.generation_value++; }

  /** 获取当前实际实例，来源不存在时明确失败。 */
  resolve(id: string): ModelClient {
    const model = this.models.get(id);
    if (!model) throw new ExtensionFailure("model_unavailable", "The model's extension is unavailable", "load");
    return model;
  }

  /** 标识符自身包含来源身份；不依靠当前目录识别历史引用。 */
  owns(id: string): boolean { return /^ext_[a-f\d]{32}_model_/u.test(id); }

  /** 当前可选模型列表。 */
  list(): ModelClient[] { return [...this.models.values()]; }

  /** 惰性句柄每次调用解析当前代次，移除后禁止保留旧函数闭包。 */
  handle(id: string): ModelClient {
    const registry = this;
    return {
      id,
      get name() { return registry.models.get(id)?.name ?? id; },
      get context_window() { return registry.models.get(id)?.context_window; },
      get model_stream_policy() { return registry.models.get(id)?.model_stream_policy; },
      async stream(call: ModelCall, signal?: AbortSignal): Promise<ReadableStream<ModelStreamEvent>> { return await registry.resolve(id).stream(call, signal); },
    };
  }
}

/** 工具名满足模型工具协议，编码本地 ID 避免拼接歧义。 */
export function extension_entry_id(extension_id: string, kind: "power" | "model" | "agent" | "federation", local_id: string): string {
  const namespace = extension_id.replaceAll("-", "");
  if (!/^[a-f\d]{32}$/u.test(namespace)) throw new ExtensionFailure("project_id_invalid", "Extension identity is invalid", "load", 2);
  return `ext_${namespace}_${kind}_${createHash("sha256").update(local_id).digest("hex").slice(0, 16)}`;
}
