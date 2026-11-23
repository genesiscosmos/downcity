/**
 * 远程 Session 配置解析器。
 *
 * 负责把 transport 上可序列化的配置转换为本地 Session 输入；模型目录仍由宿主拥有。
 */

import type {
  AgentSessionSetInput,
  RemoteSessionSetInput,
} from "@downcity/agent";
import type { AgentSessionModelResolver } from "@/city/transport/types/AgentSessionModelResolver.js";

/** 把远程配置输入解析为本地 Session 可执行输入。 */
export async function resolve_remote_session_set_input(input: {
  /** 远程 transport 收到的可序列化配置。 */
  config: RemoteSessionSetInput;
  /** 宿主提供的模型解析能力。 */
  resolve_session_model?: AgentSessionModelResolver;
}): Promise<AgentSessionSetInput> {
  const model_id = input.config.model_id;
  const binding_id = input.config.binding_id;
  if (model_id !== undefined && (typeof model_id !== "string" || !model_id.trim())) throw new Error("remote session.set requires an exact non-empty model_id");
  if (binding_id !== undefined && (!model_id || typeof binding_id !== "string" || !binding_id.trim())) throw new Error("remote session.set binding_id requires a model_id and non-empty binding");
  if (!model_id && !input.config.security) {
    throw new Error("remote session.set requires model_id or security");
  }
  if (model_id && !input.resolve_session_model) {
    throw new Error("Remote Session model switching is not configured by the host");
  }
  const model = model_id
    ? await input.resolve_session_model?.(model_id, binding_id)
    : undefined;
  if (model_id && (!model || model.id !== model_id)) throw new Error("Remote Session host resolved a different model");
  if (binding_id !== undefined && model?.binding_id !== binding_id) {
    throw Object.assign(new Error("Remote Session model authorization changed"), { code: "session_model_binding_changed" });
  }
  return {
    ...(model ? { model } : {}),
    ...(input.config.security ? { security: input.config.security } : {}),
  };
}
