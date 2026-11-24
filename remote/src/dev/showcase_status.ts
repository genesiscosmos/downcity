/** 开发专用的内存 Session/Agent 门面，经过与真实 Remote 相同的状态适配器；不创建网络客户端。 */
import type { AgentInteraction, AgentSessionSummary, RemoteAgentSession } from "@downcity/agent";
import type { RemoteCityAgent } from "@downcity/city/browser";
import { message_pending_interactions, type DowncityChatConnection, type DowncityChatPanelProps } from "@downcity/ui";
import { observe_remote_status, type Remote_session_address } from "../lib/session_status";

/** 将明确标记的合成数据接到真实 UI/SDK 状态路径，答案仅在原 runtime 内丢弃或变更状态。 */
export function observe_showcase_status(session_id: string, agent_id: string, title: string, connection: DowncityChatConnection, publish: (panel: NonNullable<DowncityChatPanelProps["status_panel"]>) => void, select: (address: Remote_session_address) => Promise<void>) {
  const runtime = connection.runtime;
  const children: AgentSessionSummary[] = session_id === "tools" ? [
    { id: "fixture-child-review", type: "work", kind: "work", title: "Synthetic review", parent: { agent_id, session_id }, parent_session_type: "chat", message_count: 1, executing: true },
    { id: "fixture-child-check", type: "work", kind: "work", title: "Synthetic follow-up", parent: { agent_id, session_id: "fixture-child-review" }, parent_session_type: "work", message_count: 1 },
  ] : [];
  const pending = (): AgentInteraction[] => message_pending_interactions(runtime.get_snapshot().messages).map(item => ({
    reference: { session_type: "chat", session_id, turn_id: item.part.request.turn_id || "fixture-turn", interaction_id: item.part.interaction_id },
    interaction: item.part, can_respond: true,
  }));
  // 仅实现 observe_remote_status 实际读取的协议；所有方法均为内存数据，不触发真实工具。
  const session = { id: session_id, type: session_id.startsWith("fixture-child-") ? "work" : "chat", get: () => title } as unknown as RemoteAgentSession;
  const agent = { id: agent_id, name: agent_id === "ada" ? "Ada" : "Sage",
    sessions: { list: async () => ({ items: children, has_more: false }), get: async (id: string) => ({ status: async () => ({ state: id === "fixture-child-review" ? "running" : "idle", live_execution: id === "fixture-child-review" }) }) },
    interactions: {
      list: async () => pending(),
      subscribe: (listener: () => void) => runtime.subscribe(listener),
      respond: async (input: { /** 原请求的完整 fixture 身份。 */ reference: AgentInteraction["reference"]; /** 只传入原 runtime 的合成响应。 */ response: unknown }) => { await runtime.respond_interaction(input.reference.interaction_id, input.response); },
      submit_private: async (input: { /** 原私密问题的完整 fixture 身份。 */ reference: AgentInteraction["reference"]; /** 只由 fixture runtime 使用，永不写入日志或持久化。 */ response: unknown }) => { await runtime.respond_interaction(input.reference.interaction_id, input.response); },
    },
  } as unknown as RemoteCityAgent;
  return observe_remote_status(session, agent, publish, select);
}
