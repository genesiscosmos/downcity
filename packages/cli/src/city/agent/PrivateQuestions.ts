/**
 * CLI 私密问题的传输能力判断。
 *
 * 本地 Session 包装器提供专用私密提交方法；其他传输只有明确暴露同名方法时
 * 才允许收集私密输入，禁止回退到普通 respond。
 */
import type { AgentSession, SessionInteractionRequest } from "@downcity/agent";

/** 判断 canonical 请求是否包含至少一个私密字段。 */
export function has_private_questions(request: SessionInteractionRequest): boolean {
  if (request.type !== "question") return false;
  const payload = request.payload;
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return false;
  return Array.isArray(payload.questions) && payload.questions.some((question) =>
    question && typeof question === "object" && !Array.isArray(question) && question.type === "secret",
  );
}

/** 仅接受实际暴露专用方法的传输，不把普通 respond 当作私密通道。 */
export function supports_private_submission(session: unknown): session is Pick<AgentSession, "submit_private_question"> {
  return Boolean(session && typeof session === "object" && "submit_private_question" in session && typeof session.submit_private_question === "function");
}
