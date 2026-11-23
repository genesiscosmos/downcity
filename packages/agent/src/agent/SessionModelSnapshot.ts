/** 创建/恢复 Session 的持久模型解析；历史无证据时不借用当前 Agent 默认模型。 */
import type { DowntownModelReference, ModelClient, WorkspaceRuntime } from "@downcity/type";
import type { SessionStorage } from "../types/store/SessionStorage.js";
import { DeferredModelClient } from "../model/DeferredModelClient.js";
import type { SessionModelResolver } from "../types/model/SessionModelResolver.js";

/** 已保存 ID 的惰性模型，浏览/恢复句柄不进行网络请求，执行时才解析宿主模型。 */
export function snapshot_model(model: DowntownModelReference, current: ModelClient | undefined, resolve_model?: SessionModelResolver, get_workspace?: () => WorkspaceRuntime | undefined): ModelClient {
  if (current?.model_reference?.downtown === model.downtown && current.model_reference.id === model.id) return current;
  return new DeferredModelClient(model.id, async () => {
    if (!resolve_model) throw Object.assign(new Error(`Host cannot restore Session model: ${model.downtown}:${model.id}`), { code: "session_model_required" });
    return await resolve_model(model, get_workspace?.());
  }, undefined, model);
}

/** 新建时先保存默认快照，null 也代表明确事实；恢复时只使用已有事实。 */
export async function resolve_session_snapshot(storage: SessionStorage, current: ModelClient | undefined, creating: boolean, resolve_model?: SessionModelResolver, get_workspace?: () => WorkspaceRuntime | undefined): Promise<ModelClient | undefined> {
  let binding = await storage.read_model_binding();
  if (!binding && creating) {
    if (!current?.model_reference) return current;
    binding = { model: current.model_reference };
    await storage.write_model_binding(binding);
  }
  return binding?.model ? snapshot_model(binding.model, current, resolve_model, get_workspace) : undefined;
}
