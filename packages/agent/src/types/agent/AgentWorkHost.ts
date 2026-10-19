/**
 * Agent 工作协作的宿主端口。
 * 容器负责主体发现与项目解析，Agent 只借用端口，不依赖 City 实现或复制其索引。
 */
import type { WorkspaceRuntime } from "@downcity/type";
import type { Agent } from "@/agent/Agent.js";

/** 随容器绑定建立、解绑时释放的工作协作能力。 */
export interface AgentWorkHost {
  /** 按稳定标识解析同一容器中的目标 Agent；不存在时必须抛出错误。 */
  resolve_agent: (agent_id: string) => Agent;
  /** 为当前绑定的 Agent 解析已登记的项目 Workspace。 */
  resolve_workspace: (workspace_id: string) => Promise<WorkspaceRuntime>;
}
