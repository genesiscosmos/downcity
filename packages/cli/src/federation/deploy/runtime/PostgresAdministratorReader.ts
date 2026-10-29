/** Read the migrated active owner through the project's postgres-js dependency without changing credentials or sessions. */

import { createRequire } from "node:module";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

/** Minimal postgres-js query surface used by the read-only transaction. */
interface PostgresQuery {
  /** Execute fixed SQL and return only the requested administrator identifier. */
  unsafe: (query: string) => Promise<Array<{ /** Migrated owner administrator identifier. */ admin_id: unknown }>>;
}

/** Minimal postgres-js client surface; implementation is resolved from the project adapter. */
interface PostgresClient extends PostgresQuery {
  /** Run queries inside an explicitly read-only transaction. */
  begin: (options: string, callback: (transaction: PostgresQuery) => Promise<string>) => Promise<string>;
  /** Release preparation-only connections even after a query failure. */
  end: (options: { /** Maximum shutdown wait in seconds. */ timeout: number }) => Promise<void>;
}

/** Resolve postgres-js from the installed adapter and read the active owner on the preparation connection URL. */
export async function read_postgres_administrator(project_dir: string, database_url: string): Promise<string> {
  const project_require = createRequire(join(project_dir, "package.json"));
  const adapter_require = createRequire(project_require.resolve("@downcity/database-postgresql"));
  const { default: postgres } = await import(pathToFileURL(adapter_require.resolve("postgres")).href);
  const client = postgres(database_url, { max: 1, prepare: false, connect_timeout: 10, onnotice: () => {} }) as PostgresClient;
  try {
    return await client.begin("read only", async (transaction) => {
      const rows = await transaction.unsafe("SELECT admin_id FROM federation_administrators WHERE owner_slot = 'owner' AND status = 'active' LIMIT 1");
      const admin_id = rows[0]?.admin_id;
      if (typeof admin_id !== "string" || !admin_id.trim()) {
        throw new Error("A migrated active owner is required; PostgreSQL administrator initialization is unsupported");
      }
      return admin_id;
    });
  } finally {
    await client.end({ timeout: 5 });
  }
}
