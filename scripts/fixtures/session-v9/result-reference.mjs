/**
 * Frozen v9 ResultRef2/read-value contract for isolated offline identity conversion.
 * Optional disclosure fields are historical facts here, never accepted by current runtime.
 */
import { createHash as create_hash } from "node:crypto";
import { project_tool_result } from "./tool-result-projection.mjs";
import { disclose_result } from "./result-disclosure.mjs";
import { assert_session_id } from "../../../packages/agent/src/session/SessionIdentity.ts";

/** Historical readable-result digest, preserving the saved JSON serialization. */
export function result_digest(value) { return create_hash("sha256").update(JSON.stringify(value)).digest("base64url"); }

/** Historical ResultRef2 identity representation. */
export function create_result_ref(location, value) {
  assert_session_id(location.session_id);
  return `res_2_${Buffer.from(JSON.stringify({ ...location, digest: result_digest(value) })).toString("base64url")}`;
}

/** Reject unknown or malformed historical references before interpreting their locations. */
export function parse_result_ref(result_ref) {
  if (typeof result_ref !== "string" || !result_ref.startsWith("res_2_") || result_ref.length > 4096) throw new Error("result_ref_invalid");
  let value;
  try { value = JSON.parse(Buffer.from(result_ref.slice(6), "base64url").toString()); } catch { throw new Error("result_ref_invalid"); }
  if (!value || typeof value.session_id !== "string" || typeof value.message_id !== "string" || typeof value.part_id !== "string"
    || typeof value.digest !== "string" || !Number.isSafeInteger(value.message_sequence) || value.message_sequence < 1
    || !value.message_id || !value.part_id || !/^[A-Za-z0-9_-]{43}$/u.test(value.digest)
    || (value.category !== undefined && (typeof value.category !== "string" || !value.category.trim()))
    || Object.keys(value).some(key => !["session_id", "message_id", "message_sequence", "part_id", "category", "digest"].includes(key))) throw new Error("result_ref_invalid");
  try { assert_session_id(value.session_id); } catch { throw new Error("result_ref_invalid"); }
  return value;
}

/** Preserve historical nullish fallback semantics solely within the frozen v9 bridge. */
export function tool_result_value(part) { return project_tool_result(part.output ?? part.error ?? null); }

/** Historical projection is isolated; v10 conversion must never call it to supply evidence. */
export function disclosed_tool_result(part, location) {
  if (part.disclosure_version === 1 && part.model_output !== undefined) return part.model_output;
  const value = tool_result_value(part);
  return disclose_result(value, create_result_ref(location, value), part.state === "failed" ? "failed" : "completed");
}
