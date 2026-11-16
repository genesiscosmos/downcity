/**
 * Explicit historical schema9 bridge for v8→v9 batches and package conversion.
 * Frozen DDL/codec/readiness preserve the historical optional Tool disclosure contract.
 * This loader never grants current-runtime readiness and cannot create schema10 batches.
 */
import { load_runtime as load_protocol } from "./session-runtime.mjs";

/** Load the historical target only; callers still enforce their batch identity policy. */
export async function load_runtime() {
  const runtime = await load_protocol(true, "historical-v9");
  if (runtime.AGENT_SESSION_SCHEMA_VERSION !== 9) throw new Error("v9_tool_runtime_version_mismatch");
  return runtime;
}
