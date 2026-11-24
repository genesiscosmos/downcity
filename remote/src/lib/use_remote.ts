/**
 * Remote 连接所有者：独占 City、当前 Session 订阅与异步选择世代。
 * 所有历史与运行态读取 UI SDK 的 canonical 投影；断线后显式重连，不重发输入。
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { RemoteCity, type RemoteCityAgent } from "@downcity/city/browser";
import type { DowncityChatConnection } from "@downcity/ui";
import { observe_remote_status, type Remote_status_observer } from "./session_status";
import { connect_remote_chat } from "./chat_connection";
import type { RemoteAgentSession } from "@downcity/agent";
import type { Remote_locale, Remote_state } from "../types/remote";
import { connection_error, forget_remembered_connection, is_credential_error, read_remembered_connection, save_remembered_connection } from "./preferences";
import { normalize_city_url } from "./endpoint";

const initial_state: Remote_state = { city_url: "", agents: [], sessions: [], busy: false, loading_more: false };
const session_filter = { type: "chat", kind: "remote", limit: 30 };

/** 返回页面可见状态与最小连接操作；卸载与断开都会释放本 hook 拥有的资源。 */
export function use_remote(locale: Remote_locale) {
  const [initial_saved] = useState(read_remembered_connection);
  const saved_ref = useRef(initial_saved);
  const [state, set_state] = useState<Remote_state>(() => ({ ...initial_state, saved_city_url: initial_saved?.city_url, busy: Boolean(initial_saved) }));
  const text = (en: string, zh: string) => locale === "zh" ? zh : en;
  const city_ref = useRef<RemoteCity | undefined>(undefined);
  const agent_ref = useRef<RemoteCityAgent | undefined>(undefined);
  const connection_ref = useRef<DowncityChatConnection | undefined>(undefined);
  const unsubscribe_ref = useRef<(() => void) | undefined>(undefined);
  const status_ref = useRef<Remote_status_observer | undefined>(undefined);
  const generation_ref = useRef(0);
  const busy_ref = useRef(false);
  const paging_ref = useRef(false);

  const close_subscription = () => {
    status_ref.current?.close();
    status_ref.current = undefined;
    unsubscribe_ref.current?.();
    unsubscribe_ref.current = undefined;
    connection_ref.current?.close();
    connection_ref.current = undefined;
  };

  /** 过期响应既不能覆盖选择，也不能把已释放连接重新挂回界面。 */
  const is_current = (generation: number) => generation === generation_ref.current;
  const begin = () => {
    busy_ref.current = true;
    paging_ref.current = false;
    const generation = ++generation_ref.current;
    close_subscription();
    set_state(value => ({ ...value, connection: undefined, status_panel: undefined, busy: true, loading_more: false, error: undefined }));
    return generation;
  };
  const finish = (generation: number, error?: unknown) => {
    if (!is_current(generation)) return;
    if (is_credential_error(error)) {
      disconnect();
      forget_connection();
    }
    busy_ref.current = false;
    set_state(value => ({ ...value, busy: false, error: error ? connection_error(error, locale) : undefined }));
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
    set_state(value => ({ ...value, session_id: session.id, session_type: session.type, session_title: session.get("title"), connection }));
    status_ref.current = observe_remote_status(session, agent, panel => {
      if (is_current(generation)) set_state(value => ({ ...value, status_panel: panel }));
    }, async address => {
      if (address.agent_id !== agent.id || !is_current(generation)) throw new Error("This conversation source is no longer selected.");
      await select_session(address.session_id, address.session_type);
    });
    let was_busy = false;
    unsubscribe_ref.current = connection.runtime.subscribe(snapshot => {
      const running = snapshot.status === "streaming" || snapshot.status === "submitted" || snapshot.status === "building-context";
      if (was_busy && snapshot.status === "ready") {
        status_ref.current?.refresh();
        void refresh_sessions(agent, generation).catch(error => {
          if (is_current(generation)) finish(generation, error);
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
      const session = await agent.sessions.get(page.items[0].id, "chat");
      if (is_current(generation)) await attach_session(session, agent, generation);
    }
  };

  const connect = async (raw_url: string, token: string, remember: boolean) => {
    if (busy_ref.current) return;
    // 未勾选时清除之前的保存，避免下一次打开恢复到另一条连接。
    if (!remember && saved_ref.current) forget_connection();
    agent_ref.current = undefined;
    const previous_city = city_ref.current;
    city_ref.current = undefined;
    void previous_city?.close().catch(() => {});
    const generation = begin();
    let city: RemoteCity | undefined;
    try {
      const city_url = normalize_city_url(raw_url);
      city = new RemoteCity({ url: city_url, token: token.trim() || undefined });
      city_ref.current = city;
      const agents = await city.agents.list();
      if (!is_current(generation)) { await city.close(); return; }
      if (!agents.length) throw new Error("No authorized Agents");
      if (remember) {
        const connection = { city_url, token };
        const saved = save_remembered_connection(connection);
        if (saved) saved_ref.current = connection;
        set_state(value => ({ ...value, saved_city_url: saved_ref.current?.city_url, storage_notice: saved ? undefined : text(
          "Connected, but this browser could not remember the connection.",
          "已连接，但当前浏览器未能记住此连接。",
        ) }));
      }
      set_state(value => ({ ...value, city_url, agents, agent_id: agents[0]?.id, sessions: [], session_id: undefined }));
      if (agents[0]) await open_agent(city, agents[0].id, generation);
      finish(generation);
    } catch (error) {
      // 已发现 City 时保留壳层，允许用户重试 Agent/Session；发现失败才释放凭据。
      if (is_current(generation) && !agent_ref.current) {
        await city?.close().catch(() => {});
        if (!is_current(generation)) return;
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

  const select_session = async (session_id: string, session_type = "chat") => {
    const agent = agent_ref.current;
    if (!agent || busy_ref.current) return;
    const generation = begin();
    set_state(value => ({ ...value, session_id }));
    try {
      const session = await agent.sessions.get(session_id, session_type);
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
      const session = await agent.sessions.create({ type: "chat", kind: "remote" });
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
        sessions: [...new Map([...value.sessions, ...page.items].map(item => [item.id, item])).values()],
        next_cursor: page.next_cursor,
      }));
    } catch (error) {
      if (is_current(generation)) finish(generation, error);
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
    set_state({ ...initial_state, saved_city_url: saved_ref.current?.city_url });
  };

  /** 忘记仅撤销当前浏览器的保存；已连接会话继续使用内存凭据。 */
  const forget_connection = () => {
    if (!state.city_url) disconnect();
    const forgotten = forget_remembered_connection();
    if (forgotten) saved_ref.current = undefined;
    set_state(value => ({ ...value, saved_city_url: saved_ref.current?.city_url, storage_notice: forgotten ? undefined : text(
      "This browser could not remove the saved connection. Clear this site’s data in browser settings.",
      "当前浏览器未能移除已保存的连接，请在浏览器设置中清除此站点的数据。",
    ) }));
  };

  /** 网络失败保留保存项，用户可重试，无需再次输入私密凭据。 */
  const retry_connection = async () => {
    const saved = saved_ref.current;
    if (saved) await connect(saved.city_url, saved.token, true);
  };

  // 挂载时恢复一次；StrictMode 重放及卸载均使旧请求失效并释放资源。
  useEffect(() => {
    void retry_connection();
    return () => {
      generation_ref.current += 1;
      busy_ref.current = false;
      paging_ref.current = false;
      close_subscription();
      void city_ref.current?.close().catch(() => {});
      city_ref.current = undefined;
      agent_ref.current = undefined;
    };
  }, []);

  /** UI 需要原始交互时按完整 Session 身份读取，原状态始终由 City 拥有。 */
  const read_interaction = useCallback(async (session_id: string, interaction_id: string) => {
    const agent = agent_ref.current;
    if (!agent) throw new Error("No agent connected.");
    const items = await agent.interactions.list();
    return items.find(item => item.reference.session_id === session_id
      && item.reference.session_type === "chat" && item.reference.interaction_id === interaction_id);
  }, []);

  return { state, connect, disconnect, forget_connection, retry_connection, select_agent, select_session, create_session, load_more, read_interaction };
}
