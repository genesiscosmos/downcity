/**
 * Remote 连接所有者：独占 City、当前 Session 订阅与异步选择世代。
 * 所有历史与运行态读取 UI SDK 的 canonical 投影；断线后显式重连，不重发输入。
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { RemoteCity, type RemoteCityAgent } from "@downcity/city/browser";
import type { DowncityChatConnection } from "@downcity/ui";
import { connect_remote_chat } from "./chat_connection";
import type { RemoteAgentSession } from "@downcity/agent";
import type { Remote_state } from "../types/remote";
import { connection_error, remember_city_url } from "./preferences";
import { normalize_city_url } from "./endpoint";

const initial_state: Remote_state = { city_url: "", agents: [], sessions: [], busy: false, loading_more: false };
const session_filter = { category: "chat", limit: 30 };

/** 返回页面可见状态与最小连接操作；卸载与断开都会释放本 hook 拥有的资源。 */
export function use_remote() {
  const [state, set_state] = useState<Remote_state>(initial_state);
  const city_ref = useRef<RemoteCity | undefined>(undefined);
  const agent_ref = useRef<RemoteCityAgent | undefined>(undefined);
  const connection_ref = useRef<DowncityChatConnection | undefined>(undefined);
  const unsubscribe_ref = useRef<(() => void) | undefined>(undefined);
  const generation_ref = useRef(0);
  const busy_ref = useRef(false);
  const paging_ref = useRef(false);

  const close_subscription = () => {
    unsubscribe_ref.current?.();
    unsubscribe_ref.current = undefined;
    connection_ref.current?.close();
    connection_ref.current = undefined;
  };

  useEffect(() => () => {
    generation_ref.current += 1;
    close_subscription();
    void city_ref.current?.close().catch(() => {});
    city_ref.current = undefined;
  }, []);

  /** 过期响应既不能覆盖选择，也不能把已释放连接重新挂回界面。 */
  const is_current = (generation: number) => generation === generation_ref.current;
  const begin = () => {
    busy_ref.current = true;
    paging_ref.current = false;
    const generation = ++generation_ref.current;
    close_subscription();
    set_state(value => ({ ...value, connection: undefined, busy: true, loading_more: false, error: undefined }));
    return generation;
  };
  const finish = (generation: number, error?: unknown) => {
    if (!is_current(generation)) return;
    busy_ref.current = false;
    set_state(value => ({ ...value, busy: false, error: error ? connection_error(error) : undefined }));
  };
  const refresh_sessions = async (agent: RemoteCityAgent, generation: number) => {
    const page = await agent.sessions.list(session_filter);
    if (is_current(generation)) set_state(value => ({ ...value, sessions: page.items, next_cursor: page.next_cursor }));
    return page;
  };

  const attach_session = async (session: RemoteAgentSession, agent: RemoteCityAgent, generation: number) => {
    const connection = await connect_remote_chat(session, agent);
    if (!is_current(generation)) { connection.close(); return; }
    connection_ref.current = connection;
    set_state(value => ({ ...value, session_id: session.id, connection }));
    let was_busy = false;
    unsubscribe_ref.current = connection.runtime.subscribe(snapshot => {
      const running = snapshot.status === "streaming" || snapshot.status === "submitted" || snapshot.status === "building-context";
      if (was_busy && snapshot.status === "ready") {
        void refresh_sessions(agent, generation).catch(error => {
          if (is_current(generation)) set_state(value => ({ ...value, error: connection_error(error) }));
        });
      }
      was_busy = running;
    });
  };

  const open_agent = async (city: RemoteCity, agent_id: string, generation: number) => {
    const agent = await city.agents.get(agent_id);
    if (!is_current(generation)) return;
    agent_ref.current = agent;
    const page = await refresh_sessions(agent, generation);
    if (!is_current(generation)) return;
    if (page.items[0]) {
      const session = await agent.sessions.get(page.items[0].session_id, "chat");
      if (is_current(generation)) await attach_session(session, agent, generation);
    }
  };

  const connect = async (raw_url: string, token: string) => {
    if (busy_ref.current) return;
    const generation = begin();
    let city: RemoteCity | undefined;
    try {
      const city_url = normalize_city_url(raw_url);
      city = new RemoteCity({ url: city_url, token: token.trim() || undefined });
      city_ref.current = city;
      const agents = await city.agents.list();
      if (!is_current(generation)) { await city.close(); return; }
      remember_city_url(city_url);
      set_state(value => ({ ...value, city_url, agents, agent_id: agents[0]?.id, sessions: [], session_id: undefined }));
      if (agents[0]) await open_agent(city, agents[0].id, generation);
      finish(generation);
    } catch (error) {
      // 已发现 City 时保留壳层，允许用户重试 Agent/Session；发现失败才释放凭据。
      if (is_current(generation) && !agent_ref.current) {
        await city?.close().catch(() => {});
        city_ref.current = undefined;
        set_state(value => ({ ...value, city_url: "", agents: [], agent_id: undefined }));
      }
      finish(generation, error);
    }
  };

  const select_agent = async (agent_id: string) => {
    const city = city_ref.current;
    if (!city || busy_ref.current) return;
    const generation = begin();
    agent_ref.current = undefined;
    set_state(value => ({ ...value, agent_id, sessions: [], session_id: undefined, next_cursor: undefined }));
    try { await open_agent(city, agent_id, generation); finish(generation); }
    catch (error) { finish(generation, error); }
  };

  const select_session = async (session_id: string) => {
    const agent = agent_ref.current;
    if (!agent || busy_ref.current) return;
    const generation = begin();
    set_state(value => ({ ...value, session_id }));
    try {
      const session = await agent.sessions.get(session_id, "chat");
      if (is_current(generation)) await attach_session(session, agent, generation);
      finish(generation);
    } catch (error) { finish(generation, error); }
  };

  const create_session = async () => {
    const agent = agent_ref.current;
    if (!agent || busy_ref.current) return;
    const generation = begin();
    set_state(value => ({ ...value, session_id: undefined }));
    try {
      const session = await agent.sessions.create({ origin: { category: "chat", type: "agent" } });
      if (!is_current(generation)) return;
      // 先保存身份，订阅失败后仍可重新打开已创建会话，避免重试时重复创建。
      set_state(value => ({ ...value, session_id: session.id }));
      await refresh_sessions(agent, generation);
      if (is_current(generation)) await attach_session(session, agent, generation);
      finish(generation);
    } catch (error) { finish(generation, error); }
  };

  const load_more = async () => {
    const agent = agent_ref.current;
    const cursor = state.next_cursor;
    if (!agent || !cursor || paging_ref.current || busy_ref.current) return;
    paging_ref.current = true;
    const generation = generation_ref.current;
    set_state(value => ({ ...value, loading_more: true, error: undefined }));
    try {
      const page = await agent.sessions.list({ ...session_filter, cursor });
      if (is_current(generation)) set_state(value => ({ ...value,
        sessions: [...new Map([...value.sessions, ...page.items].map(item => [item.session_id, item])).values()],
        next_cursor: page.next_cursor,
      }));
    } catch (error) {
      if (is_current(generation)) set_state(value => ({ ...value, error: connection_error(error) }));
    } finally {
      if (is_current(generation)) { paging_ref.current = false; set_state(value => ({ ...value, loading_more: false })); }
    }
  };

  const disconnect = () => {
    generation_ref.current += 1;
    busy_ref.current = false;
    paging_ref.current = false;
    close_subscription();
    const city = city_ref.current;
    city_ref.current = undefined;
    agent_ref.current = undefined;
    void city?.close().catch(() => {});
    set_state(initial_state);
  };

  /** UI 需要原始交互时按完整 Session 身份读取，原状态始终由 City 拥有。 */
  const read_interaction = useCallback(async (session_id: string, interaction_id: string) => {
    const agent = agent_ref.current;
    if (!agent) throw new Error("No agent connected.");
    const items = await agent.interactions.list();
    return items.find(item => item.reference.session_id === session_id
      && item.reference.session_category === "chat" && item.reference.interaction_id === interaction_id);
  }, []);

  return { state, connect, disconnect, select_agent, select_session, create_session, load_more, read_interaction };
}
