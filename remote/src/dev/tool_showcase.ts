/** Development-only tool scenario. Canonical-shaped records use the real SDK projector; no tools execute. */
import { create_chat_runtime, session_message_to_chat_message } from "@downcity/ui";

/** Builds a replayable synthetic runtime, with approval bound to its original Tool Call. */
export function create_tool_showcase(schedule: (callback: () => void, delay_ms: number) => void) {
  let phase: "preparing" | "ready" | "running" | "finished" = "preparing";
  let approval: "pending" | "resolved" | "denied" = "pending";
  let replay_id = 0;
  const project_messages = () => [
    { id: "fixture-tools-user", role: "user" as const, content: "Review the launch notes, check the links, and prepare a team update." },
    session_message_to_chat_message({
      message_id: `fixture-tools-agent-${replay_id}`, role: "agent", sequence: 2, state: "completed", parts: [
        { part_id: "fixture-tools-intro", type: "text", sequence: 1, text: "**Synthetic tool activity** · nothing is executed or sent. Expand a row to inspect its input and result. Send any message to replay the preparing → running → completed/failed transitions." },
        { part_id: "fixture-tools-read", type: "tool", sequence: 2, tool_call_id: "fixture-read-call", tool_name: "read", state: "completed", input: { file_path: "docs/launch-notes.md" }, output: { success: true, content: "Launch goal: one useful conversation.\nOwner: the product team.\nNext step: review the connection and chat flow." } },
        { part_id: "fixture-tools-action", type: "action", sequence: 2.5, action_id: "fixture-command", action_type: "command", state: "completed", title: "Session configuration updated" },
        { part_id: "fixture-tools-write", type: "tool", sequence: 3, tool_call_id: "fixture-write-call", tool_name: "write", state: phase === "preparing" ? "input-streaming" : phase === "ready" ? "ready" : phase === "running" ? "running" : "completed", input_text: '{"file_path":"drafts/team-update.md","content":"A small, thoughtful launch', input: phase === "preparing" ? undefined : { file_path: "drafts/team-update.md", content: "A small, thoughtful launch: connect, converse, decide." }, output: phase === "finished" ? { success: true, lines_written: 1, file_path: "drafts/team-update.md", bytes_written: 52, synthetic: true } : undefined },
        { part_id: "fixture-tools-search", type: "tool", sequence: 4, tool_call_id: "fixture-search-call", tool_name: "grep", state: phase === "finished" ? "completed" : "running", input: { query: "https://", path: "docs/launch-notes.md" }, output: phase === "finished" ? { success: true, matches: [{ line: 12, text: "https://preview.invalid/launch-guide" }] } : undefined },
        { part_id: "fixture-tools-reasoning", type: "reasoning", sequence: 4.2, state: "done", text: "**Checking the launch plan**\n\nKeep the draft small, inspect the failed optional checks, and ask before sharing." },
        { part_id: "fixture-tools-input", type: "input", sequence: 4.5, input_id: "fixture-background", kind: "shell_result", created_at: 0, content: [{ type: "context", tag: "shell_result", context: JSON.stringify({ shell_id: "fixture-shell", status: "completed", exit_code: 0, output_preview: "Synthetic terminal result: preview scan finished. No real command ran." }) }] },
        { part_id: "fixture-tools-check", type: "tool", sequence: 5, tool_call_id: "fixture-check-call", tool_name: "shell", state: phase === "finished" ? "failed" : "running", input: { action: "exec", args: { cmd: "check-links docs/launch-notes.md" } }, error: phase === "finished" ? "Synthetic link check failed: preview.invalid returned HTTP 503. No network request was made." : undefined },
        { part_id: "fixture-tools-prior-error", type: "tool", sequence: 6, tool_call_id: "fixture-prior-call", tool_name: "read", state: "failed", input_text: '{"file_path":"docs/optional-checklist.md"}', error: "Synthetic file not found: docs/optional-checklist.md. The draft can continue without this optional checklist." },
        { part_id: "fixture-tools-share", type: "tool", sequence: 7, tool_call_id: "fixture-share-call", tool_name: "shell", state: approval === "pending" ? "waiting-user" : "completed", input: { action: "exec", args: { cmd: "share-draft drafts/team-update.md" } }, output: approval === "pending" ? undefined : { decision: approval === "resolved" ? "approved" : "denied", sent: false, explanation: "Synthetic preview only. No message was sent." }, interactions: [{
          interaction_id: `fixture-tools-approval-${replay_id}`, interaction_type: "approval", status: approval, request: {
            interaction_id: `fixture-tools-approval-${replay_id}`, turn_id: "fixture-tools-turn", type: "approval", source: { type: "tool", tool_call_id: "fixture-share-call" }, title: "Share the synthetic team update", description: "Approve or deny this example. No real message will be sent.", payload: {}, created_at: 0,
          },
        }] },
      ],
    }),
  ];
  const runtime = create_chat_runtime({
    session_id: "tools", initial_messages: project_messages(),
    submit_message: async () => replay(),
    stop_generation: async () => { replay_id += 1; runtime.set_status("ready"); },
    respond_interaction: async (interaction_id, response) => {
      if (interaction_id !== `fixture-tools-approval-${replay_id}` || approval !== "pending") return;
      approval = typeof response === "object" && response !== null && "outcome" in response && response.outcome === "denied" ? "denied" : "resolved";
      runtime.replace_messages(project_messages());
    },
  });
  const replay = () => {
    const current_replay = ++replay_id;
    phase = "preparing";
    approval = "pending";
    runtime.replace_messages(project_messages());
    runtime.set_status("streaming");
    for (const [next_phase, delay_ms] of [["ready", 2500], ["running", 5000], ["finished", 10000]] as const) {
      schedule(() => {
        if (current_replay !== replay_id) return;
        phase = next_phase;
        runtime.replace_messages(project_messages());
        if (phase === "finished") runtime.set_status("ready");
      }, delay_ms);
    }
  };
  replay();
  return runtime;
}
