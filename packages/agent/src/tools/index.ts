/**
 * @downcity/agent/tools — 可选 Agent Tool 的公开入口。
 *
 * 这里导出的 Tool 不会由 Agent 自动注册。调用方按产品需要选择 Tool，并通过
 * `AgentOptions.tools` 显式完成组合。
 */

export { AskQuestionsTool } from "./ask/AskQuestionsTool.js";
export type {
  AskQuestionsToolInput,
  AskQuestionsToolOutput,
} from "../types/tools/ask/AskQuestionsTool.js";
