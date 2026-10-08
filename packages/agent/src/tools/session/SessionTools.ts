/**
 * Agent 会话的 Session 工具。
 *
 * 职责说明（中文）
 * - 把「Agent 手上的会话」变成模型可调用的四个动作：开一条、看状态、代答、收回。
 * - 工具与 Agent 会话的工作运行时（{@link SessionWork}）解耦：运行时由 Agent 在装配时注入，
 *   工具只调用协议，不接触 AgentSessions 或 Session 内部结构。
 * - 工具自带 description 与返回值说明，因此不需要向 instruction 注入额外文本。
 *
 * 关键点（中文）
 * - 这组工具只注册在 `origin.type === "agent"` 的会话上下文里；其他 Session 拿不到，所以不会递归派发。
 */

import {
  define_agent_tool,
  type ActionResult,
  type JsonValue,
  type ToolCallContext,
} from "@downcity/type";
import type { SessionWorkContract } from "@/types/agent/SessionWork.js";
import type {
  SessionCheckToolOutput,
  SessionReplyToolOutput,
  SessionStartToolOutput,
  SessionStopToolOutput,
} from "@/types/tools/session/SessionTools.js";
import {
  session_check_input,
  session_reply_input,
  session_start_input,
  session_stop_input,
} from "@/tools/session/SessionToolSchemas.js";

/** `session_start` 的输入。 */
type SessionStartInput = { query: string; title?: string };

/** `session_check` 的输入。 */
type SessionCheckInput = { session_id?: string; limit?: number };

/** `session_reply` 的输入。 */
type SessionReplyInput = {
  session_id: string;
  interaction_id: string;
  outcome: "resolved" | "denied";
  payload?: Record<string, unknown>;
  note?: string;
};

/** `session_stop` 的输入。 */
type SessionStopInput = { session_id: string };

/** 会话工具集；由 Agent 在 Agent 会话上下文中注入。 */
export type ChatSessionToolSet = ReturnType<typeof create_session_tools>;

/**
 * 创建 Agent 会话的四个会话工具。
 *
 * 关键点（中文）
 * - 每个工具都没有附加 messages：会话状态通过工具结果返回，不追加到对话 canonical 消息。
 */
export function create_session_tools(work: SessionWorkContract) {
  const session_start = define_agent_tool<SessionStartInput, ActionResult<SessionStartToolOutput>>({
    description:
      "Start a new session to carry out one piece of work, then return immediately. Use it when a request is larger than one reply: the user keeps talking with you while the work runs elsewhere. Write the query as a complete instruction, because the new session only sees that text.",
    input_schema: session_start_input,
    execute: async (input, context): Promise<ActionResult<SessionStartToolOutput>> => {
      // 新会话继承当前对话的目录：用户说的「顺便」通常仍指同一个项目。
      const result = await work.spawn({
        ...input,
        ...(context.workspace ? { workspace: context.workspace } : {}),
      });
      return {
        output: { session_id: result.session_id, status: "started" },
        messages: [],
      };
    },
  });

  const session_check = define_agent_tool<SessionCheckInput, ActionResult<SessionCheckToolOutput>>({
    description:
      "List the sessions you have started and what each one is doing, or pass session_id to read one session's recent messages and pending user interactions. Call this before answering questions about progress; never guess a session's state.",
    input_schema: session_check_input,
    execute: async (input): Promise<ActionResult<SessionCheckToolOutput>> => {
      const session_id = String(input.session_id || "").trim();
      if (!session_id) {
        return {
          output: { mode: "list", sessions: await work.list({ limit: input.limit }) },
          messages: [],
        };
      }
      return {
        output: await work.read({ session_id, limit: input.limit }),
        messages: [],
      };
    },
  });

  const session_reply = define_agent_tool<SessionReplyInput, ActionResult<SessionReplyToolOutput>>({
    description:
      "Answer a pending interaction on another session without the user leaving this conversation. Call session_check first to get the interaction_id, and translate the user's own words into the response payload. Use it only for interactions that are genuinely waiting.",
    input_schema: session_reply_input,
    execute: async (input): Promise<ActionResult<SessionReplyToolOutput>> => {
      // 响应载荷必须是可以序列化的 JSON，这里逐项收紧类型后再交给 Interaction 协议。
      const payload: Record<string, JsonValue> = {};
      for (const [key, value] of Object.entries(input.payload ?? {})) {
        payload[key] = value as JsonValue;
      }
      if (input.note) payload.note = input.note;
      await work.reply({
        session_id: input.session_id,
        interaction_id: input.interaction_id,
        response: {
          type: await resolve_interaction_type(work, input.session_id, input.interaction_id),
          outcome: input.outcome,
          payload,
        },
      });
      return {
        output: {
          status: input.outcome,
          session_id: input.session_id,
          interaction_id: input.interaction_id,
        },
        messages: [],
      };
    },
  });

  const session_stop = define_agent_tool<SessionStopInput, ActionResult<SessionStopToolOutput>>({
    description:
      "Stop the work running on another session, for example when the user changes their mind. The session is recorded as stopped rather than failed.",
    input_schema: session_stop_input,
    execute: async (input): Promise<ActionResult<SessionStopToolOutput>> => {
      await work.stop({ session_id: input.session_id });
      return {
        output: { session_id: input.session_id, status: "stopped" },
        messages: [],
      };
    },
  });

  return { session_start, session_check, session_reply, session_stop };
}

/**
 * 读取待响应 Interaction 的业务类型。
 *
 * 关键点（中文）：响应必须与原请求 type 一致，这是 Interaction 协议的硬约束；
 * 由这里从权威状态读出，避免让模型重复转述而写错。
 */
async function resolve_interaction_type(
  work: SessionWorkContract,
  session_id: string,
  interaction_id: string,
): Promise<string> {
  const detail = await work.read({ session_id, limit: 1 });
  const pending = detail.pending_interactions.find(
    (interaction) => interaction.interaction_id === interaction_id,
  );
  if (!pending) {
    throw new Error(`Interaction is not pending on session "${session_id}": ${interaction_id}`);
  }
  return pending.type;
}

/** 供 Agent 装配使用：把工具集暴露为普通 Tool 记录。 */
export type ChatSessionTools = ReturnType<typeof create_session_tools>;

/** 工具调用上下文类型再导出，便于宿主实现自定义会话工具时对齐。 */
export type ChatSessionToolContext = ToolCallContext;
