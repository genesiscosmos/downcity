/**
 * canonical 输入事实的统一只读视图。
 * 真人输入由 User Message 标识，运行时输入由 Agent input_id 标识；消息只承载所属 Turn。
 * 同一 Agent Message 可不断追加 input；恢复使用 canonical 消息与 Part 顺序，不依赖系统时钟。
 */
import type { SessionAgentInputPart, SessionMessage, SessionMessageMeta, SessionUserMessage } from "@downcity/type";
import type { SessionMessages } from "@/session/messages/SessionMessages.js";
import type { PromptRequestIdentity } from "@/types/session/SessionLoop.js";

/** 可用于幂等、占用恢复和请求回调的输入事实。 */
export interface SessionInputFact {
  /** 独立于承载 Message 的稳定输入标识。 */
  input_id: string;
  /** canonical 承载消息，提供实际 Turn 及导入来源。 */
  message: SessionMessage;
  /** 真人 User Message 或运行时 input Part。 */
  input: SessionUserMessage | SessionAgentInputPart;
  /** 只属于当前输入的请求记账，不混用同一 Message 中其他 input 的 meta。 */
  meta?: SessionMessageMeta;
}

/** 展开输入并保持 canonical 消息/Part 顺序，忽略模型输出和辅助 Action。 */
export function session_input_facts(messages: readonly SessionMessage[]): SessionInputFact[] {
  return messages.flatMap((message): SessionInputFact[] => message.role === "user"
    ? [{ input_id: message.message_id, message, input: message, meta: message.meta }]
    : message.parts.flatMap((part) => part.type === "input"
      ? [{ input_id: part.input_id, message, input: part, meta: part.meta }]
      : []));
}

/** 为请求级 callback 精确选取一个输入，避免同 Message 的其他 input 被重复投递。 */
export function select_session_input(messages: readonly SessionMessage[], input_id: string): SessionMessage[] {
  return messages.flatMap((message): SessionMessage[] => {
    if (message.role === "user") return message.message_id === input_id ? [message] : [];
    const parts = message.parts.filter((part) => part.type === "input" && part.input_id === input_id);
    return parts.length ? [{ ...message, parts }] : [];
  });
}

/** 按 canonical 顺序定位最新输入，调用方另行排除导入历史并检查其所属 Turn。 */
export function latest_session_input(messages: readonly SessionMessage[]): SessionInputFact | undefined {
  return session_input_facts(messages).filter((fact) => fact.message.turn_id)
    .sort((left, right) => left.message.sequence - right.message.sequence
      || left.input.sequence - right.input.sequence).at(-1);
}

/** 同时检查两类事实身份，禁止同一 request_id 在真人与运行时输入间复用。 */
export async function read_prompt_input(
  messages: Pick<SessionMessages, "read_message" | "read_input">,
  identity: PromptRequestIdentity,
): Promise<SessionInputFact | null> {
  const message = await messages.read_message(identity.message_id);
  const input = await messages.read_input(identity.input_id);
  // 离线迁移保留历史 user-request Message ID；它现在可以是同一 Input 的独立载体。
  // 只有两次查询指向同一消息和同一输入时才接受，跨消息身份碰撞仍然拒绝。
  if (message && input) {
    if (message.role !== "agent" || input.message.message_id !== message.message_id
      || !message.parts.some(part => part.type === "input" && part.input_id === identity.input_id)) {
      throw new Error("Session prompt request identity conflicts with canonical history");
    }
    return { input_id: input.part.input_id, message: input.message, input: input.part, meta: input.part.meta };
  }
  if (message) {
    if (message.role !== "user") throw new Error("Session prompt request identity conflicts with canonical history");
    return { input_id: message.message_id, message, input: message, meta: message.meta };
  }
  if (!input) return null;
  return { input_id: input.part.input_id, message: input.message, input: input.part, meta: input.part.meta };
}
