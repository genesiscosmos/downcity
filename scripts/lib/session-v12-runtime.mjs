/** Frozen published v12 schema, codec and readiness for explicit offline conversions. */
import { load_runtime as load_protocol } from "./session-runtime.mjs";

/** Never interpret a historical v12 database using the current schema or build output. */
export async function load_runtime() {
  return load_protocol(true, "historical-v12");
}
