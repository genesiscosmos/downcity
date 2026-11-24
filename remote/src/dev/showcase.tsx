/** Isolated Vite-development showcase. Uses only in-memory synthetic data; no transport or storage. */
import { useEffect, useRef, useState } from "react";
import { create_chat_runtime, type DowncityChatConnection, type DowncityChatMessage } from "@downcity/ui";
import { observe_showcase_status } from "./showcase_status";
import type { Remote_status_observer } from "../lib/session_status";
import { create_tool_showcase } from "./tool_showcase";
import { Remote_shell } from "../components/remote_shell";
import type { Remote_workspace_props } from "../types/components";
import type { Remote_locale, Remote_state } from "../types/remote";

const fixture_messages: DowncityChatMessage[] = [
  { id: "user-1", role: "user", content: "Let’s make the first week feel simple. What should we focus on for the launch?" },
  { id: "assistant-1", role: "assistant", content: "I’d build the week around one clear outcome: **help someone finish their first useful conversation.**\n\nStart with three things:\n\n1. A welcoming connection flow.\n2. A quiet space for the conversation.\n3. A clear next step when the agent needs a decision.\n\nEverything else can wait until we see where people get stuck." },
  { id: "user-2", role: "user", content: "Good. Can you turn that into a short plan we can share with the team?" },
  { id: "assistant-2", role: "assistant", content: "Here’s a small plan for the week.\n\n| Focus | Outcome |\n| --- | --- |\n| Connect | Open your City and find the right agent |\n| Converse | Keep messages easy to read, with room to think |\n| Decide | Make approvals clear without interrupting the conversation |\n\nWe’ll review the complete flow on a laptop and a phone, then share what we learn.\n\n```ts\nconst launch_goal = \"One useful conversation\";\n```\n\nWould you like to start with the conversation experience?" },
];

/** Return a canonical-shaped synthetic request; dummy answers are discarded by the fixture runtime. */
const read_fixture_interaction: Remote_workspace_props["controller"]["read_interaction"] = async (session_id, interaction_id) => ({
  reference: { session_type: "chat", session_id, turn_id: "fixture-turn", interaction_id },
  can_respond: true,
  interaction: { interaction_id, interaction_type: "question", status: "pending", request: {
    interaction_id, turn_id: "fixture-turn", type: "question", source: { type: "tool", tool_call_id: "fixture-tool" },
    payload: {}, created_at: 0,
  } },
});

/** Exercises the real workspace and shared composer without creating a City client. */
export function Remote_showcase() {
  const [locale, set_locale] = useState<Remote_locale>("en");
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const [state, set_state] = useState<Remote_state>(() => ({
    city_url: "https://synthetic.invalid", busy: false, loading_more: false,
    agents: [
      { id: "ada", name: "Ada", description: "A thoughtful partner for building things." },
      { id: "sage", name: "Sage", description: "Research, ideas, and a fresh perspective." },
    ],
    agent_id: "ada", session_id: "launch",
    sessions: [
      { id: "launch", type: "chat", kind: "remote", title: "A thoughtful launch", message_count: 4 },
      { id: "tools", type: "chat", kind: "remote", title: "Tool activity", message_count: 2 },
      { id: "notes", type: "chat", kind: "remote", title: "Notes from the garden", message_count: 2 },
      { id: "approval", type: "chat", kind: "remote", title: "A decision to make", message_count: 1 },
      { id: "private", type: "chat", kind: "remote", title: "A private question", message_count: 1 },
    ],
  }));
  const connections = useRef(new Map<string, DowncityChatConnection>());
  const status_observer = useRef<Remote_status_observer | undefined>(undefined);
  const current_agent_id = useRef("ada");
  const open_session = async (session_id: string, empty = false) => {
    let connection = connections.current.get(session_id);
    if (!connection) {
      let history_loaded = false;
      let response_timer: ReturnType<typeof setTimeout> | undefined;
      const messages = empty ? [] : session_id === "approval" ? [{ id: "approval-message", role: "assistant" as const, content: "The draft is ready. Shall I share it with the team?", parts: [
        { id: "approval-text", type: "text" as const, text: "The draft is ready. Shall I share it with the team?" },
        { id: "approval-part", type: "interaction" as const, interaction_id: "fixture-approval", interaction_type: "approval", interaction_status: "pending", title: "Share the launch plan", description: "Synthetic preview · no message will be sent." },
      ] }] : session_id === "private" ? [{ id: "private-message", role: "assistant" as const, parts: [{ id: "private-part", type: "interaction" as const, interaction_id: "fixture-private", interaction_type: "question", interaction_status: "pending", title: "Synthetic private question", questions: [{ id: "preview_secret", prompt: "Enter any dummy value to preview the private field.", response_type: "secret" as const }] }] }] : fixture_messages;
      const runtime = session_id === "tools" ? create_tool_showcase((callback, delay_ms) => timers.current.push(setTimeout(callback, delay_ms))) : create_chat_runtime({
        session_id, initial_messages: messages,
        submit_message: async input => {
          runtime.replace_messages([...runtime.get_snapshot().messages, { id: crypto.randomUUID(), role: "user", content: input.text }]);
          runtime.set_status("streaming");
          clearTimeout(response_timer);
          response_timer = setTimeout(() => {
            if (runtime.get_snapshot().status !== "streaming") return;
            runtime.replace_messages([...runtime.get_snapshot().messages, { id: crypto.randomUUID(), role: "assistant", content: "This is an isolated preview response. Your message stays in this tab. Try a follow-up while I’m responding to explore the queue, or use Stop." }]);
            runtime.set_status("ready");
          }, 8000);
          timers.current.push(response_timer);
        },
        stop_generation: async () => { clearTimeout(response_timer); runtime.set_status("ready"); },
        respond_interaction: async interaction_id => {
          runtime.replace_messages(runtime.get_snapshot().messages.map(message => ({ ...message, parts: message.parts?.map(part => part.type === "interaction" && part.interaction_id === interaction_id ? { ...part, interaction_status: "resolved" } : part) })));
        },
      });
      if (session_id === "tools") {
        await runtime.submit({ text: "Synthetic queued follow-up: review the launch copy", attachments: [] }, "queue");
        await runtime.submit({ text: "Synthetic queued follow-up: summarize the checklist", attachments: [] }, "queue");
      }
      runtime.subscribe(snapshot => set_state(current => ({ ...current, sessions: current.sessions.map(item => item.id === session_id ? { ...item, executing: snapshot.status === "streaming" } : item) })));
      connection = { runtime, close: () => {}, load_earlier: async () => {
        if (session_id !== "tools" && !history_loaded && runtime.get_snapshot().messages.length) {
          runtime.replace_messages([{ id: "earlier", role: "user", content: "Earlier in this conversation: let’s keep the launch small and useful." }, ...runtime.get_snapshot().messages]);
        }
        history_loaded = true;
        return false;
      } };
      connections.current.set(session_id, connection);
    }
    status_observer.current?.close();
    const current_connection = connection;
    const session_title = session_id.startsWith("fixture-child-") ? "Synthetic child conversation" : undefined;
    set_state(current => ({ ...current, session_id, connection, session_type: session_id.startsWith("fixture-child-") ? "work" : "chat", session_title, status_panel: undefined }));
    status_observer.current = observe_showcase_status(session_id, current_agent_id.current, session_title ?? session_id, current_connection, panel => {
      set_state(current => current.connection === current_connection ? { ...current, status_panel: panel } : current);
    }, async address => { await open_session(address.session_id); });
  };
  useEffect(() => {
    void open_session(new URLSearchParams(window.location.search).get("scenario") === "tools" ? "tools" : "launch");
    return () => { timers.current.forEach(clearTimeout); status_observer.current?.close(); connections.current.clear(); };
  }, []);
  const controller: Remote_workspace_props["controller"] = {
    state,
    connect: async () => {}, retry_connection: async () => {}, forget_connection: () => {},
    disconnect: () => { connections.current.clear(); void open_session("launch"); },
    select_session: async session_id => open_session(session_id),
    select_agent: async agent_id => { current_agent_id.current = agent_id; set_state(current => ({ ...current, agent_id })); await open_session(`${agent_id}-new`, true); },
    create_session: async () => {
      const id = crypto.randomUUID();
      set_state(current => ({ ...current, sessions: [{ id, type: "chat", kind: "remote", title: "New conversation", message_count: 0 }, ...current.sessions] }));
      await open_session(id, true);
    },
    load_more: async () => {},
    read_interaction: read_fixture_interaction,
  };
  return <Remote_shell controller={controller} locale={locale} on_locale_change={() => set_locale(current => current === "en" ? "zh" : "en")} showcase />;
}
