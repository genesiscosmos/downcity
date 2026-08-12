/**
 * 远程 Session 配置解析器。
 *
 * 负责把 transport 上可序列化的配置转换为本地 Session 输入；模型目录仍由宿主拥有。
 */

import type {
  AgentSessionSetInput,
  RemoteSessionSetInput,
} from "@downcity/agent";
import type { AgentSessionModelResolver } from "@/transport/types/AgentSessionModelResolver.js";

/** 把远程配置输入解析为本地 Session 可执行输入。 */
export async function resolve_remote_session_set_input(input: {
  /** 远程 transport 收到的可序列化配置。 */
  config: RemoteSessionSetInput;
  /** 宿主提供的模型解析能力。 */
  resolve_session_model?: AgentSessionModelResolver;
}): Promise<AgentSessionSetInput> {
  const model_id = String(input.config.model_id || "").trim();
  if (!model_id && !input.config.security) {
    throw new Error("remote session.set requires model_id or security");
  }
  if (model_id && !input.resolve_session_model) {
    throw new Error("Remote Session model switching is not configured by the host");
  }
  const model = model_id
    ? await input.resolve_session_model?.(model_id)
    : undefined;
  return {
    ...(model ? { model } : {}),
    ...(input.config.security ? { security: input.config.security } : {}),
  };
}
