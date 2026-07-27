/**
 * TaskRunner 类型定义。
 *
 * 关键点（中文）
 * - 这里集中声明 task runner 在拆分后跨模块共享的内部类型。
 * - 这些类型服务于 task 运行链路，统一归档到 `src/types/task/`。
 */

import type { SessionMessages } from "@downcity/agent";
import type { SessionExecutor } from "@downcity/agent";
import type {
  ShipTaskRunExecutionStatusV1,
  ShipTaskRunProgressPhaseV1,
  ShipTaskRunProgressStatusV1,
  ShipTaskRunResultStatusV1,
  ShipTaskRunStatusV1,
} from "@/task/types/Task.js";

/**
 * run-progress.json 的当前快照状态。
 */
export type RunProgressSnapshot = {
  /**
   * 当前进度状态。
   */
  status: ShipTaskRunProgressStatusV1;
  /**
   * 当前进度阶段。
   */
  phase: ShipTaskRunProgressPhaseV1;
  /**
   * 当前阶段对人类可读的说明文本。
   */
  message: string;
  /**
   * 当前对话轮次。
   */
  round?: number;
  /**
   * 最大允许轮次。
   */
  maxRounds?: number;
  /**
   * 运行结束时间（毫秒时间戳）。
   */
  endedAt?: number;
  /**
   * 任务总体运行状态。
   */
  runStatus?: ShipTaskRunStatusV1;
  /**
   * 执行阶段状态。
   */
  executionStatus?: ShipTaskRunExecutionStatusV1;
  /**
   * 结果校验状态。
   */
  resultStatus?: ShipTaskRunResultStatusV1;
};

/**
 * 任务结果校验结果。
 */
export type TaskResultValidation = {
  /**
   * 结果校验后的状态。
   */
  resultStatus: ShipTaskRunResultStatusV1;
  /**
   * 校验失败时的错误列表。
   */
  errors: string[];
};

/**
 * 模拟用户的判定结果。
 */
export type UserSimulatorDecision = {
  /**
   * 模拟用户是否认为当前结果已满足要求。
   */
  satisfied: boolean;
  /**
   * 模拟用户给出的回复文本。
   */
  reply: string;
  /**
   * 判定理由。
   */
  reason: string;
  /**
   * 可选评分，范围通常为 0-10。
   */
  score?: number;
  /**
   * 原始输出文本快照。
   */
  raw: string;
};

/**
 * 单轮对话的落盘记录。
 */
export type DialogueRoundRecord = {
  /**
   * 当前任务是否启用了 review 多轮模式。
   */
  reviewEnabled: boolean;
  /**
   * 当前轮次编号。
   */
  round: number;
  /**
   * 本轮执行器收到的 query。
   */
  executorQuery: string;
  /**
   * 本轮执行器输出文本。
   */
  executorOutput: string;
  /**
   * 本轮执行器是否通过 `chat_send` 等方式实际送达文本。
   */
  executorDelivered: boolean;
  /**
   * 执行器最终文本的调试快照。
   */
  executorAssistantMessageSnapshot?: string;
  /**
   * 本轮结果校验状态。
   */
  validationResultStatus: ShipTaskRunResultStatusV1;
  /**
   * 本轮规则校验失败项。
   */
  ruleErrors: string[];
  /**
   * 模拟用户收到的 query。
   */
  userSimulatorQuery?: string;
  /**
   * 模拟用户输出文本。
   */
  userSimulatorOutput?: string;
  /**
   * 模拟用户最终文本的调试快照。
   */
  userSimulatorAssistantMessageSnapshot?: string;
  /**
   * 模拟用户最终判定结果。
   */
  userSimulator: UserSimulatorDecision;
  /**
   * 传递给下一轮执行器的反馈文本。
   */
  feedbackForNextRound?: string;
};

/**
 * script 类型任务的执行结果。
 */
export type ScriptExecutionResult = {
  /**
   * script 标准输出与标准错误合并后的文本。
   */
  outputText: string;
};

/**
 * task 运行专用的 session runtime 端口。
 *
 * 关键点（中文）
 * - task runner 不直接依赖具体 SDK `Session` 实现。
 * - 这里暴露的是 task 场景最小可用端口：执行器 + canonical Messages。
 */
export type TaskSessionRuntimePort = {
  /**
   * 获取指定 session_id 对应的 Session 执行端口。
   */
  get_executor(session_id: string): SessionExecutor;
  /**
   * 获取指定 session_id 对应的 canonical Session Messages。
   */
  get_messages(session_id: string): SessionMessages;
};

/**
 * 从 assistant 输出中提取的文本结果。
 */
export type ChatSendOutputPick = {
  /**
   * 最终提取到的文本内容。
   */
  text: string;
  /**
   * 该文本是否已经通过 chat_send 等方式送达。
   */
  delivered: boolean;
};
