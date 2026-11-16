/**
 * Historical v7 offline bridge.
 *
 * The source database definition is frozen in this tools directory. Canonical codecs are
 * shared layout-free protocols; the current Agent schema is loaded only when requested by
 * maintenance callers and remains subject to their explicit v8/v9 target gates.
 * No store, host or automatic data conversion is constructed here.
 */
import { load_runtime as load_current_runtime } from "./session-runtime.mjs";
import * as schema from "./session-v7-schema.mjs";

/** Load the fixed v7 format alongside the pure protocol modules used by its converter. */
export async function load_runtime(agent_database = false) {
  return Object.assign({}, schema, await load_current_runtime(agent_database));
}
