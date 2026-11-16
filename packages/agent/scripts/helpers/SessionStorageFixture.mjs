/**
 * Existing storage/City regressions' isolated v9 Session facade fixture.
 * Callers supply a temporary Agent root and permanent UUID. The fixture uses the real
 * runtime lease and facade, releases both at suite teardown, and preserves subclass hooks
 * used to inject write failures. It does not implement a historical store interface.
 */
import path from "node:path";
import { after } from "node:test";
import { acquire_agent_session_storage } from "../../bin/session/storage/agent-db/AgentSessionRuntime.js";
import { AgentSessionStorage } from "../../bin/session/storage/agent-db/AgentSessionStorage.js";

/** Open a real file-backed v9 facade in the test's temporary directory. */
export async function create_session_storage(options, storage_type = AgentSessionStorage) {
  const storage_root_path = options.storage_root_path ?? path.dirname(options.database_path);
  const lease = await acquire_agent_session_storage({ agent_id: options.agent_id,
    database_path: path.join(storage_root_path, "sessions.db"), allow_create: true }, false);
  const storage = new storage_type({ files: options.files, agent_id: options.agent_id,
    session_id: options.session_id, workspace_id: options.workspace_id,
    origin: options.origin, storage_root_path, lease });
  const dispose_view = storage.dispose.bind(storage);
  storage.dispose = async () => { await dispose_view(); await lease.release(); };
  after(() => storage.dispose());
  return storage;
}
