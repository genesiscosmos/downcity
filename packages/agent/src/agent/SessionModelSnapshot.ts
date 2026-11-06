/** 创建/恢复 Session 的持久模型解析；历史无证据时不借用当前 Agent 默认模型。 */
import type { ModelClient, WorkspaceRuntime } from "@downcity/type";
import type { SessionStorage } from "../types/store/SessionStorage.js";

/** 已保存 ID 的惰性模型，浏览/恢复句柄不进行网络请求，执行时才解析宿主模型。 */
export function snapshot_model(model_id: string, current: ModelClient | undefined, resolve_model?: (model_id: string, workspace?: WorkspaceRuntime) => Promise<ModelClient>, workspace?: WorkspaceRuntime): ModelClient {
  if (current?.id === model_id) return current;
  let resolved: Promise<ModelClient> | undefined;
  return { id: model_id, stream: async (call, signal) => {
    if (!resolve_model) throw Object.assign(new Error(`Host cannot restore persisted Session model: ${model_id}`), { code: "session_model_required" });
    resolved ??= resolve_model(model_id, workspace).catch((error) => { resolved = undefined; throw error; });
    return await (await resolved).stream(call, signal);
  } };
}

/** 新建时先保存默认快照，null 也代表明确事实；恢复时只使用已有事实。 */
export async function resolve_session_snapshot(storage: SessionStorage, current: ModelClient | undefined, creating: boolean, resolve_model?: (model_id: string, workspace?: WorkspaceRuntime) => Promise<ModelClient>, workspace?: WorkspaceRuntime): Promise<ModelClient | undefined> {
  let binding = await storage.read_model_binding();
  if (!binding && creating) {
    binding = { default_model_id: current?.id ?? null };
    await storage.write_model_binding(binding);
  }
  const model_id = binding?.override_model_id ?? binding?.default_model_id;
  return model_id ? snapshot_model(model_id, current, resolve_model, workspace) : undefined;
}
