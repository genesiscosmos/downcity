/**
 * TaskRunArtifacts：task run 产物写入辅助模块。
 *
 * 关键点（中文）
 * - 把 `input/output/result/error/dialogue/run.json` 的写入逻辑从 Runner 主链拆出。
 * - Runner 只保留执行编排；产物格式与 markdown 结构统一收敛在这里。
 */

import fs from "fs-extra";
import path from "node:path";
import type { DialogueRoundRecord } from "@/task/runtime/TaskRunnerTypes.js";
import type {
  ShipTaskDefinitionV1,
  ShipTaskKind,
  ShipTaskRunExecutionStatusV1,
  ShipTaskRunMetaV1,
  ShipTaskRunResultStatusV1,
  ShipTaskRunStatusV1,
  ShipTaskRunTriggerV1,
} from "@/task/types/Task.js";
import { summarizeText, toMdLink } from "./TaskRunnerProgress.js";

/**
 * 单次 run 的文件路径集合。
 */
export interface TaskRunFilePaths {
  /**
   * 输入快照 markdown 路径。
   */
  inputMdPath: string;
  /**
   * 输出 markdown 路径。
   */
  outputMdPath: string;
  /**
   * 结果摘要 markdown 路径。
   */
  resultMdPath: string;
  /**
   * 错误 markdown 路径。
   */
  errorMdPath: string;
  /**
   * 对话摘要 markdown 路径。
   */
  dialogueMdPath: string;
  /**
   * 对话原始 json 路径。
   */
  dialogueJsonPath: string;
  /**
   * 运行元数据 json 路径。
   */
  metaJsonPath: string;
  /**
   * 运行进度快照路径。
   */
  progressJsonPath: string;
}

/**
 * task 输入快照写入参数。
 */
export interface WriteTaskRunInputArtifactParams {
  /**
   * 当前任务定义。
   */
  task: ShipTaskDefinitionV1;
  /**
   * 本次 executionId。
   */
  executionId: string;
  /**
   * 任务类型。
   */
  taskKind: ShipTaskKind;
  /**
   * 是否启用 review。
   */
  reviewEnabled: boolean;
  /**
   * 最大轮次。
   */
  maxDialogueRounds: number;
  /**
   * input.md 路径。
   */
  inputMdPath: string;
}

/**
 * task 最终产物写入参数。
 */
export interface WriteTaskRunArtifactsParams {
  /**
   * 当前任务定义。
   */
  task: ShipTaskDefinitionV1;
  /**
   * executionId。
   */
  executionId: string;
  /**
   * run 时间戳。
   */
  timestamp: string;
  /**
   * 触发来源。
   */
  trigger: ShipTaskRunTriggerV1;
  /**
   * run 相对目录。
   */
  runDirRel: string;
  /**
   * 文件路径集合。
   */
  filePaths: TaskRunFilePaths;
  /**
   * 任务类型。
   */
  taskKind: ShipTaskKind;
  /**
   * 是否启用 review。
   */
  reviewEnabled: boolean;
  /**
   * 最大轮次。
   */
  maxDialogueRounds: number;
  /**
   * 实际执行轮次。
   */
  dialogueRounds: number;
  /**
   * 对话轮次记录。
   */
  dialogueRecords: DialogueRoundRecord[];
  /**
   * 整体执行是否成功。
   */
  ok: boolean;
  /**
   * 最终 run 状态。
   */
  status: ShipTaskRunStatusV1;
  /**
   * 执行阶段状态。
   */
  executionStatus: ShipTaskRunExecutionStatusV1;
  /**
   * 结果校验状态。
   */
  resultStatus: ShipTaskRunResultStatusV1;
  /**
   * 结果错误列表。
   */
  resultErrors: string[];
  /**
   * 模拟用户是否满意。
   */
  userSimulatorSatisfied: boolean;
  /**
   * 模拟用户回复。
   */
  userSimulatorReply: string;
  /**
   * 模拟用户理由。
   */
  userSimulatorReason: string;
  /**
   * 模拟用户评分。
   */
  userSimulatorScore?: number;
  /**
   * 最终输出文本。
   */
  outputText: string;
  /**
   * 最终错误文本。
   */
  errorText: string;
  /**
   * 运行开始时间。
   */
  startedAt: number;
  /**
   * 运行结束时间。
   */
  endedAt: number;
}

/**
 * 根据 runDir 生成标准文件路径集合。
 */
export function createTaskRunFilePaths(runDirAbs: string): TaskRunFilePaths {
  return {
    inputMdPath: path.join(runDirAbs, "input.md"),
    outputMdPath: path.join(runDirAbs, "output.md"),
    resultMdPath: path.join(runDirAbs, "result.md"),
    errorMdPath: path.join(runDirAbs, "error.md"),
    dialogueMdPath: path.join(runDirAbs, "dialogue.md"),
    dialogueJsonPath: path.join(runDirAbs, "dialogue.json"),
    metaJsonPath: path.join(runDirAbs, "run.json"),
    progressJsonPath: path.join(runDirAbs, "run-progress.json"),
  };
}

/**
 * 写入 input.md。
 */
export async function writeTaskRunInputArtifact(
  params: WriteTaskRunInputArtifactParams,
): Promise<void> {
  await fs.writeFile(
    params.inputMdPath,
    [
      `# Task Input`,
      ``,
      `- taskId: \`${params.task.taskId}\``,
      `- executionId: \`${params.executionId}\``,
      `- title: ${params.task.frontmatter.title}`,
      `- when: \`${params.task.frontmatter.when}\``,
      `- status: \`${params.task.frontmatter.status}\``,
      `- session_id: \`${params.task.frontmatter.session_id}\``,
      `- kind: \`${params.taskKind}\``,
      ...(params.taskKind === "agent"
        ? [`- review: \`${String(params.reviewEnabled)}\``]
        : []),
      `- maxDialogueRounds: \`${params.maxDialogueRounds}\``,
      ``,
      `## Body`,
      ``,
      params.task.body ? params.task.body : "_(empty body)_",
      ``,
    ].join("\n"),
    "utf-8",
  );
}

function buildDialogueLines(params: WriteTaskRunArtifactsParams): string[] {
  const lines: string[] = [];
  lines.push("# Task Dialogue");
  lines.push("");
  lines.push(`- taskId: \`${params.task.taskId}\``);
  lines.push(`- maxDialogueRounds: \`${params.maxDialogueRounds}\``);
  lines.push(`- dialogueRounds: \`${params.dialogueRounds}\``);
  lines.push(`- userSimulatorSatisfied: \`${String(params.userSimulatorSatisfied)}\``);
  lines.push(`- messages: ${toMdLink(path.posix.join(params.runDirRel, "messages.jsonl"))}`);
  if (params.reviewEnabled) {
    lines.push(
      `- userSimulatorMessages: ${toMdLink(path.posix.join(params.runDirRel, "user-simulator/messages.jsonl"))}`,
    );
  }
  lines.push("");

  for (const round of params.dialogueRecords) {
    lines.push(`## Round ${round.round}`);
    lines.push("");
    lines.push(`- reviewEnabled: \`${String(round.reviewEnabled)}\``);
    lines.push(`- executorDelivered: \`${String(round.executorDelivered)}\``);
    lines.push(`- validationResultStatus: \`${round.validationResultStatus}\``);
    lines.push("");
    lines.push("### Executor query");
    lines.push("");
    lines.push("```");
    lines.push(summarizeText(round.executorQuery, 4000) || "_(empty query)_");
    lines.push("```");
    lines.push("");
    lines.push("### Executor output preview");
    lines.push("");
    lines.push("```");
    lines.push(summarizeText(round.executorOutput, 1200) || "_(empty output)_");
    lines.push("```");
    lines.push("");
    if (round.executorAssistantMessageSnapshot) {
      lines.push("### Executor raw assistant_message snapshot");
      lines.push("");
      lines.push("```json");
      lines.push(round.executorAssistantMessageSnapshot);
      lines.push("```");
      lines.push("");
    }
    lines.push("### Rule checks");
    lines.push("");
    if (round.ruleErrors.length === 0) {
      lines.push("- PASS");
    } else {
      for (const item of round.ruleErrors) lines.push(`- FAIL: ${item}`);
    }
    lines.push("");
    lines.push("### User simulator");
    lines.push("");
    lines.push(`- satisfied: \`${String(round.userSimulator.satisfied)}\``);
    if (typeof round.userSimulator.score === "number") {
      lines.push(`- score: \`${round.userSimulator.score}\``);
    }
    if (round.userSimulator.reason) {
      lines.push(`- reason: ${round.userSimulator.reason}`);
    }
    if (round.userSimulatorQuery) {
      lines.push("");
      lines.push("query:");
      lines.push("```");
      lines.push(summarizeText(round.userSimulatorQuery, 4000));
      lines.push("```");
    }
    if (round.userSimulatorOutput) {
      lines.push("");
      lines.push("output:");
      lines.push("```");
      lines.push(summarizeText(round.userSimulatorOutput, 2000));
      lines.push("```");
    }
    if (round.userSimulator.reply) {
      lines.push("");
      lines.push("reply:");
      lines.push("```");
      lines.push(summarizeText(round.userSimulator.reply, 1200));
      lines.push("```");
    }
    if (round.userSimulatorAssistantMessageSnapshot) {
      lines.push("");
      lines.push("raw assistant_message snapshot:");
      lines.push("```json");
      lines.push(round.userSimulatorAssistantMessageSnapshot);
      lines.push("```");
    }
    if (round.feedbackForNextRound) {
      lines.push("");
      lines.push("feedbackForNextRound:");
      lines.push("```");
      lines.push(summarizeText(round.feedbackForNextRound, 2000));
      lines.push("```");
    }
    lines.push("");
  }

  return lines;
}

function buildResultLines(params: WriteTaskRunArtifactsParams): string[] {
  const durationMs = params.endedAt - params.startedAt;
  const outputPreview = summarizeText(params.outputText, 1200);
  const lines: string[] = [];
  lines.push(`# Task Result`);
  lines.push("");
  lines.push(`- taskId: \`${params.task.taskId}\``);
  lines.push(`- executionId: \`${params.executionId}\``);
  lines.push(`- title: ${params.task.frontmatter.title}`);
  lines.push(`- trigger: \`${params.trigger.type}\``);
  lines.push(`- status: **${params.status.toUpperCase()}**`);
  lines.push(`- executionStatus: \`${params.executionStatus}\``);
  lines.push(`- resultStatus: \`${params.resultStatus}\``);
  lines.push(`- dialogueRounds: \`${params.dialogueRounds}/${params.maxDialogueRounds}\``);
  lines.push(`- userSimulatorSatisfied: \`${String(params.userSimulatorSatisfied)}\``);
  if (typeof params.userSimulatorScore === "number") {
    lines.push(`- userSimulatorScore: \`${params.userSimulatorScore}\``);
  }
  lines.push(`- startedAt: \`${new Date(params.startedAt).toISOString()}\``);
  lines.push(`- endedAt: \`${new Date(params.endedAt).toISOString()}\``);
  lines.push(`- durationMs: \`${durationMs}\``);
  lines.push(`- runDir: ${toMdLink(params.runDirRel)}`);
  lines.push("");
  lines.push(`## Artifacts`);
  lines.push("");
  lines.push(`- messages: ${toMdLink(path.posix.join(params.runDirRel, "messages.jsonl"))}`);
  if (params.taskKind === "agent" && params.reviewEnabled) {
    lines.push(
      `- userSimulatorMessages: ${toMdLink(path.posix.join(params.runDirRel, "user-simulator/messages.jsonl"))}`,
    );
  }
  lines.push(`- input: ${toMdLink(path.posix.join(params.runDirRel, "input.md"))}`);
  lines.push(`- output: ${toMdLink(path.posix.join(params.runDirRel, "output.md"))}`);
  lines.push(`- result: ${toMdLink(path.posix.join(params.runDirRel, "result.md"))}`);
  lines.push(`- dialogue: ${toMdLink(path.posix.join(params.runDirRel, "dialogue.md"))}`);
  lines.push(`- dialogueJson: ${toMdLink(path.posix.join(params.runDirRel, "dialogue.json"))}`);
  if (params.status === "failure") {
    lines.push(`- error: ${toMdLink(path.posix.join(params.runDirRel, "error.md"))}`);
  }
  lines.push("");
  lines.push(`## Result checks`);
  lines.push("");
  if (params.resultErrors.length === 0) {
    lines.push(`- PASS`);
  } else {
    for (const item of params.resultErrors) {
      lines.push(`- FAIL: ${item}`);
    }
  }
  lines.push("");

  if (outputPreview) {
    lines.push(`## Output preview`);
    lines.push("");
    lines.push("```");
    lines.push(outputPreview);
    lines.push("```");
    lines.push("");
  }

  if (params.status === "failure" && params.errorText) {
    lines.push(`## Error preview`);
    lines.push("");
    lines.push("```");
    lines.push(summarizeText(params.errorText, 1200));
    lines.push("```");
    lines.push("");
  }

  return lines;
}

/**
 * 写入 task run 的最终产物。
 */
export async function writeTaskRunArtifacts(
  params: WriteTaskRunArtifactsParams,
): Promise<void> {
  await fs.writeFile(
    params.filePaths.outputMdPath,
    [`# Task Output`, ``, params.outputText ? params.outputText : "_(empty output)_", ``].join(
      "\n",
    ),
    "utf-8",
  );

  if (params.status === "failure") {
    await fs.writeFile(
      params.filePaths.errorMdPath,
      [`# Task Error`, ``, params.errorText || "Unknown error", ``].join("\n"),
      "utf-8",
    );
  } else {
    try {
      await fs.remove(params.filePaths.errorMdPath);
    } catch {
      // ignore
    }
  }

  await fs.writeJson(
    params.filePaths.dialogueJsonPath,
    {
      v: 1,
      taskId: params.task.taskId,
      timestamp: params.timestamp,
      maxDialogueRounds: params.maxDialogueRounds,
      rounds: params.dialogueRecords,
    },
    { spaces: 2 },
  );
  await fs.writeFile(
    params.filePaths.dialogueMdPath,
    buildDialogueLines(params).join("\n"),
    "utf-8",
  );

  const meta: ShipTaskRunMetaV1 = {
    v: 1,
    taskId: params.task.taskId,
    timestamp: params.timestamp,
    executionId: params.executionId,
    session_id: params.task.frontmatter.session_id,
    trigger: params.trigger,
    status: params.status,
    executionStatus: params.executionStatus,
    resultStatus: params.resultStatus,
    ...(params.resultErrors.length > 0 ? { resultErrors: params.resultErrors } : {}),
    dialogueRounds: params.dialogueRounds,
    userSimulatorSatisfied: params.userSimulatorSatisfied,
    ...(params.userSimulatorReply
      ? { userSimulatorReply: summarizeText(params.userSimulatorReply, 2000) }
      : {}),
    ...(params.userSimulatorReason
      ? { userSimulatorReason: summarizeText(params.userSimulatorReason, 2000) }
      : {}),
    ...(typeof params.userSimulatorScore === "number"
      ? { userSimulatorScore: params.userSimulatorScore }
      : {}),
    startedAt: params.startedAt,
    endedAt: params.endedAt,
    ...(params.status === "failure" && params.errorText
      ? { error: summarizeText(params.errorText, 800) }
      : {}),
  };
  await fs.writeJson(params.filePaths.metaJsonPath, meta, { spaces: 2 });
  await fs.writeFile(
    params.filePaths.resultMdPath,
    buildResultLines(params).join("\n"),
    "utf-8",
  );
}
