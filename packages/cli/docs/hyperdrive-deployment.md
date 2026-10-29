# Hyperdrive deployment contract

The CLI accepts an existing Hyperdrive resource in `federation.json`:

```json
{
  "deployment": {
    "target": "cloudflare-workers",
    "resources": {
      "hyperdrive": {
        "type": "hyperdrive",
        "binding": "HYPERDRIVE",
        "id_env": "DOWNCITY_HYPERDRIVE_ID",
        "database_url_env": "DOWNCITY_DATABASE_URL"
      }
    }
  }
}
```

This fragment supplements the normal Federation project fields. Configure exactly one database resource: `d1` or `hyperdrive`. D1 templates still declare D1 explicitly. The CLI no longer synthesizes a D1 database when no database resource is declared. Queue defaults remain unchanged.

Configure exactly one of `id` (an existing 32-character hexadecimal ID) or `id_env` (the process environment variable holding that ID). The reader resolves `id_env` and blocks on missing or invalid values; no placeholder ID is needed. The normalized type contains the resolved `id` and optional `id_env` name. The CLI does not create Supabase instances or Hyperdrive resources. The existing Hyperdrive must already point to the intended PostgreSQL database. Worker deployment receives `[[hyperdrive]]` with its binding, ID and `remote = true`.

The Worker must export `async prepare_database(env)` and await the existing Federation preparation API. It must use the same PostgreSQL adapter/schema as the runtime, and release any preparation-only database clients before returning. Use the project's existing postgres-js adapter; the CLI adds no PostgreSQL driver dependency.

Without `database_url_env`, preparation uses Wrangler's remote platform proxy and requires a usable Hyperdrive `connectionString`. Wrangler/platform versions that cannot proxy Hyperdrive require the independent connection mode.

With `database_url_env`, the CLI reads that named variable from its inherited process environment, checks for a PostgreSQL URL, and calls preparation with both `env.HYPERDRIVE.connectionString` (using the configured binding name) and `env.PREPARE_DATABASE_URL` (using the configured variable name). This mode bypasses the entire platform proxy; no Queue, R2 or other platform bindings are supplied to preparation. The CLI supplies `DOWNCITY_STORAGE_PUBLIC_URL_PREFIX` from the configured storage resource so R2Storage can be constructed. Source inspection confirms cloudflareQueue does not dereference its binding until send, and R2Storage does not dereference its bucket until store. Preparation must not send queue messages or store objects. The independent URL must target the same database/schema as production Hyperdrive. Only the variable name is configuration; never put a connection URL or password in federation.json. Connection values are not added to the child command or generated Wrangler file. Preparation output is captured and failure output is suppressed to avoid exposing driver connection diagnostics.

Dry-run builds and checks the preparation export without reading the connection variable or preparing a database. Verify-only does not prepare the database.

PostgreSQL migration deployment does not require an existing local administrator registry entry. Before invoking the preparation export, the child resolves postgres-js via `createRequire` from the project's installed `@downcity/database-postgresql` adapter and queries `admin_id` for `owner_slot = 'owner' AND status = 'active'` inside a read-only transaction, using the same URL passed to preparation. This only reads the administrator identifier; it does not read or write passwords or sessions. The temporary query client is closed in finally. The parent receives only the ID through a temporary result file and registers it after successful deployment. Missing/inactive owners or query failures block preparation/upload. Explicit `admin-reset` is blocked before build. New administrator initialization remains unsupported. Dry-run checks the export only and does not validate migrated administrators. This change does not transfer or verify all migrated production data.

## Local schema preparation before importing migrated data

The core Federation and official Worker expose `prepare_schema`; it creates empty tables without identity/key bootstrap. The runner accepts `operation: "prepare_schema"` and deliberately skips the migrated administrator query. Omitted operation defaults to `prepare_database`, which is also what normal deployment uses. Both modes validate the selected Worker export in dry-run.

After compiling the CLI, run the following from the repository root with the ID and URL already provided in the process environment. Set `FEDERATION_PROJECT_DIR` to the Worker project; its storage resource must declare the real `public_url_prefix`. The Worker must export the selected operation. This explicitly executes schema preparation against the configured database; run it only for the intended migration target.

```bash
node --input-type=module <<'NODE'
import { resolve } from 'node:path';
import { read_federation_project_config } from './public/packages/cli/bin/federation/deploy/config/FederationProjectConfigReader.js';
import { run_worker_database_prepare } from './public/packages/cli/bin/federation/deploy/runtime/WorkerDatabasePrepareRunner.js';
try {
  if (!process.env.FEDERATION_PROJECT_DIR) throw new Error('Project directory required');
  const project = read_federation_project_config(process.env.FEDERATION_PROJECT_DIR);
  const hyperdrive = project.config.deployment.resources.hyperdrive;
  if (!hyperdrive?.database_url_env) throw new Error('Independent preparation connection required');
  await run_worker_database_prepare({
    project_dir: project.project_dir,
    entry: resolve(project.project_dir, project.config.entry),
    config_path: '', // unused when database_url_env is configured
    dry_run: false, // true validates the export without touching the database
    operation: 'prepare_schema',
    hyperdrive,
    storage_public_url_prefix: project.config.deployment.resources.storage?.public_url_prefix,
  });
  console.log('Schema preparation completed');
} catch {
  console.error('Schema preparation failed; connection diagnostics suppressed');
  process.exitCode = 1;
}
NODE
```

After importing and validating all data, use normal deployment/`prepare_database` to complete indexes and runtime preparation and read the migrated active owner. No new CLI command is required.

Local validation performed: TypeScript compilation and build alias verification; offline configuration/writer assertions. No live Supabase, Hyperdrive or database integration was exercised.
