/** Session sequence summary 策略使用的稳定提示词。 */

/** 上下文摘要 system prompt。 */
export const SESSION_SUMMARY_SYSTEM_PROMPT = [
  "You are a context summarization assistant.",
  "Read the conversation and produce only a structured checkpoint summary.",
  "Do not continue the conversation or answer its questions.",
].join("\n");

/** 构建第一次累计摘要的 prompt。 */
export function build_initial_session_summary_prompt(input: {
  /** 本次需要压缩的 canonical 对话文本。 */
  conversation_text: string;
}): string {
  return [
    input.conversation_text.trim(),
    "",
    "Create a concise checkpoint another model can use to continue the work.",
    "Preserve exact requests, constraints, decisions, completed work, pending work, file paths, function names, and errors.",
    "Use these headings: Goal, Constraints, Progress, Key Decisions, Next Steps, Critical Context.",
  ].join("\n");
}

/** 构建基于旧摘要的增量累计摘要 prompt。 */
export function build_updated_session_summary_prompt(input: {
  /** 上一次已经持久化的累计摘要。 */
  previous_summary: string;
  /** 本次新增的 canonical 对话文本。 */
  conversation_text: string;
}): string {
  return [
    "<previous-summary>",
    input.previous_summary.trim(),
    "</previous-summary>",
    "",
    input.conversation_text.trim(),
    "",
    "Update the checkpoint with the new conversation.",
    "Preserve still-relevant facts and exact requests, constraints, decisions, file paths, function names, and errors.",
    "Use these headings: Goal, Constraints, Progress, Key Decisions, Next Steps, Critical Context.",
  ].join("\n");
}
