/** 通用 Chat 展示协议与 canonical Activity/Interaction 的边界；不参与执行或私密 transport。 */
import type { JsonValue, SessionAgentInteraction } from "@downcity/type";
import type { AgentActivityPart } from "../types/chat-blocks";
import type { DowncityChatContentPart, DowncityChatMessagePart } from "../types/chat";

/** SDK 投影优先保留 canonical 快照；受控 Chat 宿主可仅提供公开展示字段。 */
export function chat_activity_part(part: DowncityChatMessagePart, sequence: number): AgentActivityPart | undefined {
  if (part.type !== "input" && part.activity_part) return part.activity_part;
  const base = { part_id: part.id, sequence };
  if (part.type === "input") return { ...base, ...part, created_at: part.created_at ?? 0 };
  if (part.type === "reasoning") return { ...base, type: "reasoning", text: part.text ?? "", state: part.state === "streaming" ? "streaming" : "done" };
  if (part.type === "tool") return { ...base, type: "tool", tool_call_id: part.tool_call_id ?? part.id, tool_name: part.tool_name ?? "tool", state: tool_state(part.tool_state), input_text: part.input_text, input: part.input as JsonValue | undefined, output: part.output as JsonValue | undefined, error: part.error };
  if (part.type === "operation" && part.operation) return { ...base, type: "action", action_id: part.id, action_type: part.operation.name, title: part.operation.label ?? part.operation.name, description: part.operation.error, state: part.operation.status === "failed" ? "failed" : ["finished", "completed"].includes(part.operation.status) ? "completed" : "running" };
  return undefined;
}
/** 仅接受已知状态，不把未知中间态伪装成成功。 */
function tool_state(state?: string): Extract<AgentActivityPart, { type: "tool" }>["state"] {
  return state === "input-streaming" || state === "ready" || state === "waiting-user" || state === "completed" || state === "failed" ? state : "running";
}
/** 受控消息的交互展示字段还原为状态面板请求；真实连接继续使用完整 canonical 请求。 */
export function chat_interaction(part: DowncityChatContentPart): SessionAgentInteraction | undefined {
  if (part.type !== "interaction" || !part.interaction_id) return undefined;
  if (part.interaction) return part.interaction;
  return { interaction_id: part.interaction_id, interaction_type: part.interaction_type ?? "question", status: part.interaction_status === "resolved" || part.interaction_status === "denied" || part.interaction_status === "failed" || part.interaction_status === "cancelled" ? part.interaction_status : "pending",
    request: { interaction_id: part.interaction_id, turn_id: "", type: part.interaction_type ?? "question", title: typeof part.title === "string" ? part.title : undefined, description: typeof part.description === "string" ? part.description : undefined,
      source: { type: "tool", tool_call_id: part.interaction_tool_call_id ?? part.id }, created_at: 0,
      payload: (part.interaction_payload ?? { questions: part.questions?.map(question => ({ question_id: question.id, question: question.prompt, type: question.response_type, options: question.options })) ?? [] }) as JsonValue,
    },
  };
}
