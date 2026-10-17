/**
 * Agent 会话的统一 session 工具。
 *
 * 通过 action + args 分发 start/check/reply/stop；省略 action 返回动作索引与 Schema。
 * 工具仅依赖 SessionWork 协议，由 Agent 注入主会话与 Channel 会话。
 * Work Session 不注入此工具，防止递归派发；调用身份始终来自 ToolCallContext。
 */

import { z } from "zod";
import { define_agent_tool, type ActionResult, type JsonValue, type ToolCallContext } from "@downcity/type";
import type { SessionWorkContract } from "@/types/agent/SessionWork.js";
import {
  session_check_input,
  session_reply_input,
  session_start_input,
  session_stop_input,
  session_tool_input,
} from "@/tools/session/SessionToolSchemas.js";

/** 动作说明和输入 Schema 同源，用于无 action 时的能力发现。 */
const session_actions = {
  start: {
    description: "Start work in an explicitly selected project and return immediately. Write a complete query: the new session only sees that text. Discover projects with context.workspaces.list; never use the main session's private Workspace. Completion or failure automatically returns to the calling conversation; do not poll for completion.",
    schema: session_start_input,
  },
  check: {
    description: "List sessions or inspect one session's recent messages and pending interactions. Call before answering progress questions; never guess the state.",
    schema: session_check_input,
  },
  reply: {
    description: "Answer a pending interaction on another session. Call check first for interaction_id, then translate the user's own words into the response payload. Only answer interactions that are waiting.",
    schema: session_reply_input,
  },
  stop: {
    description: "Stop another session's work when the user asks. The session is recorded as stopped rather than failed.",
    schema: session_stop_input,
  },
};

/** 创建单一模型入口；每次调用均校验 envelope 和对应动作参数。 */
export function create_session_tools(work: SessionWorkContract) {
  const session = define_agent_tool<z.infer<typeof session_tool_input>, ActionResult>({
    description: "Manage this agent's sessions: start project work, check progress, reply to pending interactions, or stop work. Call with { action, args }; omit action to read all action descriptions and input schemas. Work results return automatically to this conversation.",
    input_schema: session_tool_input,
    execute: async (input, context): Promise<ActionResult> => {
      const { action, args = {} } = session_tool_input.parse(input);
      if (!action) {
        return {
          output: {
            actions: Object.entries(session_actions).map(([name, definition]) => ({
              action: name,
              description: definition.description,
              input_schema: z.toJSONSchema(definition.schema),
            })),
          },
          messages: [],
        };
      }
      switch (action) {
        case "start": {
          const params = session_start_input.parse(args);
          if (!context.turn_id || !context.tool_call_id) {
            throw new Error("session.start requires an active Turn tool call");
          }
          const result = await work.spawn(params, {
            session_id: context.session_id,
            origin: context.session_origin,
            turn_id: context.turn_id,
            tool_call_id: context.tool_call_id,
          });
          return {
            output: { session_id: result.session_id, delegation_id: result.delegation_id, status: "started" },
            messages: [],
          };
        }
        case "check": {
          const params = session_check_input.parse(args);
          return {
            output: params.session_id
              ? await work.read({ session_id: params.session_id, limit: params.limit })
              : { mode: "list", sessions: await work.list({ limit: params.limit }) },
            messages: [],
          };
        }
        case "reply": {
          const params = session_reply_input.parse(args);
          // Interaction payload 必须可序列化，拒绝非 JSON 值后再交给运行时。
          const payload = z.record(z.string(), z.json()).parse(params.payload ?? {});
          if (params.note) payload.note = params.note;
          await work.reply({
            session_id: params.session_id,
            interaction_id: params.interaction_id,
            response: {
              type: await resolve_interaction_type(work, params.session_id, params.interaction_id),
              outcome: params.outcome,
              payload: payload as Record<string, JsonValue>,
            },
          });
          return {
            output: { status: params.outcome, session_id: params.session_id, interaction_id: params.interaction_id },
            messages: [],
          };
        }
        case "stop": {
          const params = session_stop_input.parse(args);
          await work.stop({ session_id: params.session_id });
          return { output: { session_id: params.session_id, status: "stopped" }, messages: [] };
        }
      }
    },
  });
  return { session };
}

/** 从权威状态读取待响应 Interaction 的类型，保证响应与原请求匹配。 */
async function resolve_interaction_type(
  work: SessionWorkContract,
  session_id: string,
  interaction_id: string,
): Promise<string> {
  const detail = await work.read({ session_id, limit: 1 });
  const pending = detail.pending_interactions.find((interaction) => interaction.interaction_id === interaction_id);
  if (!pending) {
    throw new Error(`Interaction is not pending on session "${session_id}": ${interaction_id}`);
  }
  return pending.type;
}

/** 会话工具集；由 Agent 在主会话及 Channel 会话中注入。 */
export type ChatSessionToolSet = ReturnType<typeof create_session_tools>;

/** 供 Agent 装配使用的工具集合。 */
export type ChatSessionTools = ReturnType<typeof create_session_tools>;

/** 工具调用上下文，供宿主对齐自定义会话工具。 */
export type ChatSessionToolContext = ToolCallContext;
