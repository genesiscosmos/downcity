/** 面向协调 Session 的交互引用投影；公开问题可读取，审批和私密输入保留在原受信入口。 */
import type { SessionInteractionRequest } from "@downcity/type";
import { interaction_questions } from "./PrivateQuestionResponse.js";

/** 不复制交互状态；公开问题内容只作为原 Interaction 的只读投影。 */
export function project_session_interaction(request: SessionInteractionRequest) {
  const public_question = request.type === "question"
    && !interaction_questions(request).some((question) => question.type === "secret");
  return {
    interaction_id: request.interaction_id,
    type: request.type,
    ...(request.title ? { title: request.title } : {}),
    ...(request.description ? { description: request.description } : {}),
    ...(public_question ? { payload: request.payload } : {}),
    requires_direct_response: !public_question,
  };
}
