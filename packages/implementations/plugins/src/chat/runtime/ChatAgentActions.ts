/** Chat Plugin 面向 Agent 的严格会话内 Actions。 */

import { create_action } from "@downcity/city/plugin";
import type { PluginActions } from "@downcity/city/plugin";
import { z } from "zod";
import type { ChatRuntime } from "./ChatRuntime.js";

const session_input = z.object({
  session_id: z.string().min(1).optional(),
}).strict();

/** 创建只允许访问当前 Agent Conversation 的 Chat Actions。 */
export function create_chat_agent_actions(
  resolve_runtime: () => ChatRuntime,
): PluginActions {
  return ({
    context: create_action({
      description: "Read the current external chat conversation context.",
      input_schema: session_input,
      execute: async ({ context, execution, input }) => {
        const session_id = input.session_id || execution.snapshot.session_id || "";
        const conversation = session_id
          ? resolve_runtime().store.get_conversation_by_session(session_id)
          : null;
        if (!conversation || conversation.agent_id !== context.agent.id) {
          return { success: false, error: "Current Session is not a Chat conversation" };
        }
        return { success: true, data: conversation as unknown as import("@downcity/city/plugin").PluginJsonValue };
      },
    }),
    list: create_action({
      description: "List external chat conversations owned by the current Agent.",
      input_schema: z.object({}).strict(),
      execute: async ({ context }) => ({
        success: true,
        data: resolve_runtime().store.list_agent_conversations(context.agent.id) as unknown as import("@downcity/city/plugin").PluginJsonValue,
      }),
    }),
    history: create_action({
      description: "Read canonical Agent Session messages for a Chat conversation.",
      input_schema: session_input,
      execute: async ({ context, execution, input }) => {
        const session_id = input.session_id || execution.snapshot.session_id || "";
        const conversation = session_id
          ? resolve_runtime().store.get_conversation_by_session(session_id)
          : null;
        if (!conversation || conversation.agent_id !== context.agent.id) {
          return { success: false, error: "Chat conversation is not owned by the current Agent" };
        }
        const session = await context.agent.sessions.get(session_id, "chat");
        return { success: true, data: await session.messages() };
      },
    }),
    send: create_action({
      description: "Reliably send text to a Chat conversation owned by the current Agent.",
      input_schema: z.object({
        session_id: z.string().min(1).optional(),
        text: z.string().min(1),
        available_at: z.number().int().nonnegative().optional(),
      }).strict(),
      execute: async ({ context, execution, input }) => {
        const session_id = input.session_id || execution.snapshot.session_id || "";
        if (!session_id) return { success: false, error: "session_id is required" };
        const delivery_id = resolve_runtime().send_from_agent({
          agent_id: context.agent.id,
          session_id,
          text: input.text,
          available_at: input.available_at,
        });
        return { success: true, data: { delivery_id, session_id } };
      },
    }),
    react: create_action({
      description: "Reliably react to a Telegram message in a conversation owned by the current Agent.",
      input_schema: z.object({
        session_id: z.string().min(1).optional(),
        message_id: z.string().min(1),
        emoji: z.string().min(1),
        is_big: z.boolean().optional(),
      }).strict(),
      execute: async ({ context, execution, input }) => {
        const session_id = input.session_id || execution.snapshot.session_id || "";
        if (!session_id) return { success: false, error: "session_id is required" };
        try {
          const delivery_id = resolve_runtime().react_from_agent({
            agent_id: context.agent.id,
            session_id,
            message_id: input.message_id,
            emoji: input.emoji,
            is_big: input.is_big,
          });
          return { success: true, data: { delivery_id, session_id } };
        } catch (error) {
          return {
            success: false,
            error: error instanceof Error ? error.message : String(error),
          };
        }
      },
    }),
  }) as unknown as PluginActions;
}
