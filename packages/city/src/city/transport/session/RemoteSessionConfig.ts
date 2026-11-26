/**
 * 远程 Session 配置解析器。
 *
 * 负责把 transport 上可序列化的配置转换为本地 Session 输入；模型目录仍由宿主拥有。
 */
import type {
  AgentSessionSetInput,
  RemoteSessionSetInput,
} from "@downcity/agent";

/** 把远程配置输入解析为本地 Session 可执行输入。 */
export async function resolve_remote_session_set_input(input: {
  /** 远程 transport 收到的可序列化配置。 */
  config: RemoteSessionSetInput;
}): Promise<AgentSessionSetInput> {
  if ("model" in input.config) throw new Error("agent_model_owned: configure the Agent model");
  if (!input.config.security) throw new Error("remote session.set requires security");
  return { security: input.config.security };
}
