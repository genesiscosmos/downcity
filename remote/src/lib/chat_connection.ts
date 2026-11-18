/** Session 与 UI 的边界适配：保留原会话身份，私密问答经过 Agent 专用入口提交。 */
import type { RemoteAgentSession } from "@downcity/agent";
import type { RemoteCityAgent } from "@downcity/city/browser";
import { connect_chat_session } from "@downcity/ui";

/** 仅检测问题声明，不读取、复制或记录任何私密答案。 */
function contains_secret(payload: unknown): boolean {
  if (!payload || typeof payload !== "object" || !("questions" in payload) || !Array.isArray(payload.questions)) return false;
  return payload.questions.some(question => question && typeof question === "object" && "type" in question && question.type === "secret");
}

/** 用轻量适配器复用 SDK 的历史合并、流式状态与带 checkpoint 的停止逻辑。 */
export function connect_remote_chat(session: RemoteAgentSession, agent: RemoteCityAgent) {
  return connect_chat_session({
    id: session.id,
    watch: (listener, on_close) => session.watch(listener, on_close),
    messages: input => session.messages(input),
    status: () => session.status(),
    prompt: input => session.prompt({ ...input, request_id: crypto.randomUUID() }),
    stop: (turn_id, message) => session.stop(turn_id, message),
    retry_model_step: input => session.retry_model_step(input),
    respond: async input => {
      const pending = await agent.interactions.list();
      const item = pending.find(item => item.reference.session_id === session.id
        && item.reference.session_category === session.origin.category
        && item.reference.interaction_id === input.interaction_id);
      if (!item?.can_respond) throw new Error("This interaction is no longer awaiting a response.");
      const response = { reference: item.reference, response: input.response };
      return contains_secret(item.interaction.request.payload)
        ? agent.interactions.submit_private(response)
        : agent.interactions.respond(response);
    },
  });
}
