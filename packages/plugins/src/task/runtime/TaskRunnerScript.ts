/**
 * TaskRunnerScript：script 类型任务执行分支。
 *
 * 关键点（中文）
 * - script 任务是 one-shot 执行，不进入 agent 多轮评审。
 * - 这里集中处理 script 执行、结果校验与进度更新，Runner 主链只消费归一化结果。
 */

import type { PluginContext } from "@downcity/agent";
import type {
  ShipTaskRunExecutionStatusV1,
  ShipTaskRunResultStatusV1,
  ShipTaskRunStatusV1,
} from "@/task/types/Task.js";
import type { createRunProgressWriter } from "./TaskRunnerProgress.js";
import { summarizeText } from "./TaskRunnerProgress.js";
import { runScriptTask, validateTaskResult } from "./TaskRunnerRound.js";

/**
 * script 任务分支执行参数。
 */
export interface RunScriptTaskBranchParams {
  /**
   * 当前 Agent 执行上下文。
   */
  context: PluginContext;
  /**
   * script 任务绑定的 session_id。
   */
  session_id: string;
  /**
   * script 正文。
   */
  scriptBody: string;
  /**
   * run-progress.json 写入器。
   */
  runProgress: ReturnType<typeof createRunProgressWriter>;
}

/**
 * script 任务分支执行结果。
 */
export interface RunScriptTaskBranchResult {
  /**
   * 当前任务是否整体成功。
   */
  ok: boolean;
  /**
   * run 最终状态。
   */
  status: ShipTaskRunStatusV1;
  /**
   * 执行器状态。
   */
  executionStatus: ShipTaskRunExecutionStatusV1;
  /**
   * 结果校验状态。
   */
  resultStatus: ShipTaskRunResultStatusV1;
  /**
   * 结果校验错误列表。
   */
  resultErrors: string[];
  /**
   * script 固定占用一轮 dialogue 计数。
   */
  dialogueRounds: number;
  /**
   * script 任务成功时视为用户模拟器已满意。
   */
  userSimulatorSatisfied: boolean;
  /**
   * script 标准输出文本。
   */
  outputText: string;
  /**
   * 失败时的错误文本。
   */
  errorText: string;
}

/**
 * 执行 script 任务分支。
 */
export async function runScriptTaskBranch(
  params: RunScriptTaskBranchParams,
): Promise<RunScriptTaskBranchResult> {
  let ok = false;
  let status: ShipTaskRunStatusV1 = "failure";
  let executionStatus: ShipTaskRunExecutionStatusV1 = "success";
  let resultStatus: ShipTaskRunResultStatusV1 = "not_checked";
  let resultErrors: string[] = [];
  let userSimulatorSatisfied = false;
  let outputText = "";
  let errorText = "";

  await params.runProgress.update({
    status: "running",
    phase: "script_running",
    message: "Executing script task.",
    round: 1,
    maxRounds: 1,
  });

  try {
    const scriptResult = await runScriptTask({
      context: params.context,
      session_id: params.session_id,
      scriptBody: params.scriptBody,
    });
    outputText = scriptResult.outputText;
    await params.runProgress.update({
      status: "running",
      phase: "validating",
      message: "Script execution completed; validating output and artifacts.",
      round: 1,
      maxRounds: 1,
    });
    const validation = await validateTaskResult({ outputText });
    if (validation.errors.length === 0) {
      ok = true;
      status = "success";
      resultStatus = "valid";
      resultErrors = [];
      userSimulatorSatisfied = true;
    } else {
      ok = false;
      status = "failure";
      resultStatus = "invalid";
      resultErrors = [...validation.errors];
      errorText = [
        "Script task result validation failed.",
        ...resultErrors.map((item) => `- ${item}`),
      ].join("\n");
      await params.runProgress.update({
        status: "running",
        phase: "validating",
        message: "Output validation failed; preparing failure artifacts.",
        round: 1,
        maxRounds: 1,
      });
    }
  } catch (error) {
    executionStatus = "failure";
    status = "failure";
    resultStatus = "not_checked";
    resultErrors = [];
    errorText = `Script task execution failed: ${String(error)}`;
    await params.runProgress.update({
      status: "running",
      phase: "script_running",
      message: `script 执行失败: ${summarizeText(String(error), 160)}`,
      round: 1,
      maxRounds: 1,
    });
  }

  return {
    ok,
    status,
    executionStatus,
    resultStatus,
    resultErrors,
    dialogueRounds: 1,
    userSimulatorSatisfied,
    outputText,
    errorText,
  };
}
