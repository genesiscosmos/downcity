/** Remote 状态来源适配：读取已授权 Agent 的 canonical 交互与派生关系，不恢复执行器。 */
import type { AgentInteraction, AgentSessionSummary, RemoteAgentSession } from "@downcity/agent";
import type { RemoteCityAgent } from "@downcity/city/browser";
import type { DowncityChatPanelProps, PendingInteractionItem, SubSessionItem } from "@downcity/ui";

/** 当前 Agent 内完整的 Session 导航地址。 */
export interface Remote_session_address {
  /** 已获授权的 Agent 标识；响应时再次核对。 */ agent_id: string;
  /** 原 Session 的协议类型，不按标题或用途推断。 */ session_type: string;
  /** 原 Session 的稳定标识。 */ session_id: string;
}
/** 一个挂载中会话的状态来源；释放仅取消前端订阅和刷新。 */
export interface Remote_status_observer {
  /** 合并短时间的刷新请求，避免流式文字触发重复列表查询。 */ refresh(): void;
  /** 释放本观察者持有的订阅、定时器与待发布结果。 */ close(): void;
}
/** 使用当前协议读取同 Agent 后代；跨 Agent 后代没有专用查询端点，不推断其存在。 */
export function observe_remote_status(session: RemoteAgentSession, agent: RemoteCityAgent, publish: (panel: NonNullable<DowncityChatPanelProps["status_panel"]>) => void, select: (address: Remote_session_address) => Promise<void>): Remote_status_observer {
  let closed = false;
  let pending_refresh: ReturnType<typeof setTimeout> | undefined;
  let refresh_running = false;
  let refresh_again = false;
  let last_panel: NonNullable<DowncityChatPanelProps["status_panel"]> = { session_key: `${agent.id}:${session.type}:${session.id}`, interactions: { items: [], respond: async () => { throw new Error("Conversation status is not ready."); } } };
  publish(last_panel);
  const key_of = (item: AgentInteraction) => `${agent.id}:${item.reference.session_type}:${item.reference.session_id}:${item.reference.turn_id}:${item.reference.interaction_id}`;
  const refresh_now = async () => {
    if (closed) return;
    if (refresh_running) { refresh_again = true; return; }
    refresh_running = true;
    try {
      const pending = await agent.interactions.list();
      const sessions: AgentSessionSummary[] = [];
      let cursor: string | undefined;
      do {
        const page = await agent.sessions.list({ type: "work", limit: 100, cursor });
        if (closed) return;
        sessions.push(...page.items);
        cursor = page.next_cursor;
      } while (cursor);
      const descendants: Array<{ item: AgentSessionSummary; depth: number }> = [];
      const ids = new Map<string, number>([[session.id, 0]]);
      let remaining = sessions.filter(item => item.id !== session.id);
      while (remaining.length) {
        const next = remaining.filter(item => item.parent?.agent_id === agent.id && ids.has(item.parent.session_id) && (!item.parent_session_type || item.parent_session_type === (item.parent.session_id === session.id ? session.type : "work")));
        if (!next.length) break;
        for (const item of next) { const depth = ids.get(item.parent!.session_id)! + 1; ids.set(item.id, depth); descendants.push({ item, depth }); }
        remaining = remaining.filter(item => !ids.has(item.id));
      }
      const child_rows: SubSessionItem<Remote_session_address>[] = await Promise.all(descendants.map(async ({ item, depth }) => {
        const child = await agent.sessions.get(item.id, item.type);
        const runtime = await child.status();
        return { key: `${agent.id}:${item.type}:${item.id}`, address: { agent_id: agent.id, session_type: item.type, session_id: item.id }, title: item.title ?? "", depth,
          status: runtime.state === "failed" ? "failed" as const : runtime.state === "waiting_input" ? "action_required" as const : runtime.live_execution ? "working" as const : "idle" as const };
      }));
      if (closed) return;
      const relevant = pending.filter(item => item.can_respond && ids.has(item.reference.session_id)
        && (item.reference.session_id !== session.id || item.reference.session_type === session.type));
      const by_key = new Map(relevant.map(item => [key_of(item), item]));
      const interactions: PendingInteractionItem[] = relevant.map(item => ({ key: key_of(item), part: item.interaction,
        label: `${agent.name} · ${item.reference.session_id === session.id ? session.get("title") || session.id : sessions.find(child => child.id === item.reference.session_id)?.title || item.reference.session_id}`,
        open_details: () => { void select({ agent_id: agent.id, session_type: item.reference.session_type, session_id: item.reference.session_id }); },
      }));
      last_panel = { session_key: `${agent.id}:${session.type}:${session.id}`, auto_expand_interactions: true,
        interactions: { items: interactions, respond: async (input, private_question, item) => {
          const original = by_key.get(item.key ?? "");
          if (!original || original.reference.interaction_id !== input.interaction_id) throw new Error("The interaction source is no longer available.");
          const current = (await agent.interactions.list()).find(value => key_of(value) === key_of(original));
          if (!current?.can_respond) throw new Error("This interaction is no longer awaiting a response.");
          const response = { reference: current.reference, response: input.response };
          if (private_question || contains_private_question(current)) await agent.interactions.submit_private(response);
          else await agent.interactions.respond(response);
          refresh();
        } },
        sub_sessions: { items: child_rows, on_select: address => select(address as Remote_session_address) },
      };
      publish(last_panel);
    } catch {
      if (!closed) publish({ ...last_panel, error: "Could not refresh conversation status. Reconnect to try again." });
    } finally {
      refresh_running = false;
      if (refresh_again && !closed) { refresh_again = false; refresh(); }
    }
  };
  const refresh = () => {
    if (closed || pending_refresh) return;
    pending_refresh = setTimeout(() => { pending_refresh = undefined; void refresh_now(); }, 250);
  };
  const unsubscribe = agent.interactions.subscribe(refresh);
  // 现有协议没有后代列表变更流；可见会话期间周期刷新，并在页面重新聚焦时立即更新。
  const interval = setInterval(refresh, 5000);
  window.addEventListener("focus", refresh);
  refresh();
  return { refresh, close: () => { closed = true; clearTimeout(pending_refresh); clearInterval(interval); window.removeEventListener("focus", refresh); unsubscribe(); } };
}
/** 仅检查请求声明，不读取或记录任何私密答案。 */
function contains_private_question(item: AgentInteraction): boolean {
  const payload = item.interaction.request.payload;
  return Boolean(payload && typeof payload === "object" && !Array.isArray(payload) && Array.isArray(payload.questions)
    && payload.questions.some(question => question && typeof question === "object" && !Array.isArray(question) && question.type === "secret"));
}
