/**
 * Session 详情投影：读取权威存储元数据，补充当前模型显示标签与执行状态。
 * 不创建会话或执行器；保持 Session facade 的执行职责集中。
 */
import { read_model_label } from "@downcity/type";
import type { AgentSessionInfo } from "@/types/agent/SessionTypes.js";
import type { SessionInformationInput } from "@/types/session/SessionInformation.js";
import { build_session_info } from "./storage/SessionInfoProjection.js";

/** 运行时详情投影当前继承模型；历史消息里的模型事实独立保留。 */
export async function read_session_information(input: SessionInformationInput): Promise<AgentSessionInfo> {
  const metadata = await input.store.read_metadata();
  const model_label = read_model_label(input.model);
  return build_session_info({ agent_id: input.agent_id,
    session_id: input.session_id, executing: input.executing,
    metadata: { ...metadata, model_label },
  });
}
