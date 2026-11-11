/**
 * Prompt 的 canonical 接收与身份校验。
 * 运行时输入先预持久化附件及记账，再经 Turn 唯一 writer 提交 inbox；预处理不构成接收。
 */
import { nanoid } from "nanoid";
import type { SessionAgentInboxPart, SessionUserMessage } from "@downcity/type";
import type { NormalizedAgentSessionPromptInput } from "@/types/sdk/AgentSessionPrompt.js";
import { same_session_prompt_actor, session_prompt_actor_schema } from "@/types/sdk/SessionPromptActor.js";
import type { SessionMessages } from "@/session/messages/SessionMessages.js";
import type { SessionTurnContext } from "@/types/turn/SessionTurnContext.js";
import type { PromptRequestIdentity } from "@/types/session/SessionLoop.js";
import type { SessionInputFact } from "./SessionInputFacts.js";

/** 幂等输入同时绑定调用对象与 canonical 主体，禁止输入跨主体复用。 */
export function assert_prompt_actor(fact: SessionInputFact, input: NormalizedAgentSessionPromptInput): void {
  const actor = session_prompt_actor_schema.parse(fact.meta?.from);
  if (!same_session_prompt_actor(actor, input.actor)) throw new Error("request_id belongs to a different Session prompt actor");
  if (("role" in fact.input ? "user" : "inbox") !== input.input_kind) {
    throw new Error("request_id belongs to a different Session input kind");
  }
}

/** 单次 Prompt 提交所需的接收边界。 */
export interface SessionPromptPersistence {
  /** 已归一化的可信请求，不含 canonical 身份。 */
  prompt: NormalizedAgentSessionPromptInput;
  /** 为输入提供唯一 writer 和实际 Turn 归属的上下文。 */
  turn_context: SessionTurnContext;
  /** canonical 消息及附件预处理入口。 */
  messages: SessionMessages;
  /** 当前工作区根目录，用于解析输入附件。 */
  project_root: string;
  /** 业务 request_id 推导的稳定身份，缺省时生成一次输入身份。 */
  identity?: PromptRequestIdentity;
  /** 提交前最后一次检查停止代次、调用方取消与 Turn 接收窗口。 */
  assert_receivable: () => void;
}

/** 只经唯一输出端口追加 inbox；附件准备后的取消仍可阻止 canonical 接收。 */
export async function persist_prompt_input(options: SessionPromptPersistence): Promise<SessionUserMessage | SessionAgentInboxPart> {
  const { prompt, turn_context, messages, project_root, identity, assert_receivable } = options;
  if (prompt.input_kind === "user") {
    return await messages.append_prompt_message({ prompt, project_root, turn_id: turn_context.session.turn_id,
      ...(identity ? { message_id: identity.message_id } : {}), assert_receivable });
  }
  const assistant = turn_context.output.assistant;
  if (!assistant) throw new Error("Session inbox requires an Assistant output writer");
  const prepared = await messages.prepare_prompt_inbox({ prompt, project_root,
    inbox_id: identity?.inbox_id ?? `inbox:${turn_context.session.turn_id}:${nanoid()}`, assert_receivable });
  assert_receivable();
  return await assistant.append_inbox(prepared, assert_receivable);
}
