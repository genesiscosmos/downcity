/**
 * Session 详情投影：读取权威存储元数据，补充当前模型显示标签与执行状态。
 * 不创建会话或执行器，不解析主会话别名；保持 Session facade 的执行职责集中。
 */
import { read_model_label } from "@downcity/type";
import type { AgentSessionInfo } from "@/types/agent/SessionTypes.js";
import type { SessionInformationInput } from "@/types/session/SessionInformation.js";
import { build_session_info } from "./storage/SessionInfoProjection.js";

/** 存储标签优先；不以显示标签推导模型身份。 */
export async function read_session_information(input: SessionInformationInput): Promise<AgentSessionInfo> {
  const metadata = await input.store.read_metadata();
  const model_label = String(metadata.model_label || read_model_label(input.model) || "").trim();
  return build_session_info({ agent_id: input.agent_id,
    session_id: input.session_id, executing: input.executing,
    metadata: { ...metadata, ...(model_label ? { model_label } : {}) },
  });
}
