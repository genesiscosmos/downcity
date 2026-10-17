/** 方案目标解析：缺省目标由来源和真实目录补齐，用户在确认时整体接受安排。 */
import type { TaskAnalysis, TaskAnalysisInput } from "../types/TaskPreparation.js";

/** 生成可直接确认的目标建议；目录不存在时报告配置错误，不询问内部 ID。 */
export function resolve_task_delegation(analysis: TaskAnalysis, catalog: TaskAnalysisInput["catalog"], preferred_agent_id?: string, preferred_workspace_id?: string): TaskAnalysis {
  const assumptions = [...(analysis.assumptions || [])];
  if (analysis.kind === "self") return { ...analysis, assumptions, questions: [] };
  const agent_id = preferred_agent_id || (catalog.agents.some((item) => item.agent_id === analysis.agent_id) ? analysis.agent_id : catalog.agents[0]?.agent_id);
  const workspace_id = preferred_workspace_id || (catalog.workspaces.some((item) => item.workspace_id === analysis.workspace_id) ? analysis.workspace_id : catalog.workspaces[0]?.workspace_id);
  const agent = catalog.agents.find((item) => item.agent_id === agent_id);
  const workspace = catalog.workspaces.find((item) => item.workspace_id === workspace_id);
  if (!agent) throw new Error("没有可用的执行 Agent，请在设置中添加或重新选择执行者");
  if (!workspace) throw new Error("没有可用的执行工作区，请添加工作区后重新生成安排");
  if (!preferred_agent_id && analysis.agent_id !== agent_id) assumptions.push(`采用可用执行者：${agent.name}`);
  if (!preferred_workspace_id && analysis.workspace_id !== workspace_id) assumptions.push(`采用可用工作区：${workspace.name}`);
  return { ...analysis, agent_id, workspace_id, assumptions, questions: [] };
}
