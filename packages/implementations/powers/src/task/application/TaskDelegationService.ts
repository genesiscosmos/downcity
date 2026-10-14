/** 委派准备规则：校验目标与原文授权，模型建议不能自行启用执行。 */
import type { TaskAnalysis, TaskAnalysisInput } from "../types/TaskPreparation.js";
import { normalizeTaskWhen } from "../runtime/Model.js";

/** 校验模型提议的安排；含糊授权留在原任务中等待用户确认。 */
export function validate_task_delegation(analysis: TaskAnalysis, catalog: TaskAnalysisInput["catalog"], text: string): string[] {
  const questions = [...analysis.questions];
  if (analysis.kind === "agent") {
    if (!catalog.agents.some((agent) => agent.agent_id === analysis.agent_id)) questions.push("希望交给哪位 Agent？");
    if (!catalog.workspaces.some((workspace) => workspace.workspace_id === analysis.workspace_id)) questions.push("在哪个 Workspace 中执行？");
  }
  const when = normalizeTaskWhen(analysis.when);
  if (!when.ok) questions.push("请明确有效的提醒或执行时间");
  if (analysis.start_now && (analysis.kind !== "agent" || analysis.when !== "@manual")) questions.push("立即执行需要 Agent 目标，不能同时指定定时规则");
  if (when.ok && (when.value !== "@manual" || analysis.start_now)) {
    const quote = analysis.authorization_quote?.trim() || "";
    // 保守匹配明确动作；带否定的原文不能由模型删掉否定后截取授权。
    const explicit = analysis.start_now
      ? /(?:现在|立即|马上).{0,60}(?:执行|开始|生成|检查|整理|修复)|(?:run|execute|start).{0,60}(?:now|immediately)/i.test(quote)
      : analysis.kind === "self"
        ? /提醒我|提醒一下|remind me/i.test(quote)
        : /自动执行|自动完成|定时执行|到时执行|让.{0,40}(执行|生成|检查|整理)|schedule.{0,40}(agent|run)|automatically (run|execute)/i.test(quote);
    const negated = /不要|不用|无需|别|不自动|do not|don't|never/i.test(text);
    if (!quote || !text.includes(quote) || !explicit || negated) questions.push("请在任务详情中确认是否启用自动提醒或执行");
    if (when.value.startsWith("time:") && Date.parse(when.value.slice(5)) <= Date.now()) questions.push("计划触发时间已过，请指定未来时间");
  }
  return [...new Set(questions)];
}
