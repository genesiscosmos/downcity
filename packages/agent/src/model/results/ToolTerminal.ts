/**
 * Atomic first-disclosure construction for every canonical Tool terminal transition.
 * Completion, interruption and interaction paths share the same privacy projection and
 * byte budget. Already terminal Parts are validated and reused without recalculation;
 * callers persist the returned Part in their existing message transaction.
 */
import type { SessionAgentToolPart } from "@downcity/type";
import type { ResultLocation } from "@/types/model/ResultReference.js";
import { to_session_json_value } from "@/session/messages/SessionJsonValue.js";
import { project_tool_result } from "../messages/ToolResultProjection.js";
import { assert_tool_terminal, create_result_ref } from "./ResultReference.js";
import { DISCLOSURE_VERSION, disclose_result } from "./ResultDisclosure.js";

/** Inputs describing the actual first terminal result, never a historical reconstruction. */
export interface ToolTerminalInput {
  /** Exact canonical source location, including the session type when available. */
  location: ResultLocation;
  /** Actual execution outcome; interruptions and rejected interactions use failed. */
  state: "completed" | "failed";
  /** Raw execution output; JSON null is an explicit value and is preserved. */
  output: unknown;
  /** Human-readable failure detail stored separately from the bounded model snapshot. */
  error?: string;
  /** Validated pre-disclosed result returned by an action, still subject to privacy and budget. */
  disclosed?: boolean;
}

/** Construct once, or return the exact existing terminal after validating its evidence. */
export function finalize_tool(part: SessionAgentToolPart, input: ToolTerminalInput): SessionAgentToolPart {
  assert_tool_terminal(part);
  if (part.state === "completed" || part.state === "failed") return part;
  if (input.location.part_id !== part.part_id) throw new Error("tool_terminal_location_conflict");
  const output = to_session_json_value(input.output);
  const readable = project_tool_result(output);
  const result_ref = create_result_ref(input.location, readable);
  const terminal: SessionAgentToolPart = {
    ...part,
    state: input.state,
    output,
    model_output: input.disclosed ? readable : disclose_result(readable, result_ref, input.state),
    result_ref,
    disclosure_version: DISCLOSURE_VERSION,
    ...(input.state === "failed" ? { error: input.error ?? "Tool execution failed" } : {}),
  };
  assert_tool_terminal(terminal);
  return terminal;
}

/** Fix a newly interrupted/rejected Tool using the same result path as normal execution. */
export function fail_tool(part: SessionAgentToolPart, location: ResultLocation, error: string): SessionAgentToolPart {
  return finalize_tool(part, { location, state: "failed", output: { error }, error });
}
