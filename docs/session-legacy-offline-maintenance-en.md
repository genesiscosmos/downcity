<!-- Version-bound historical tool reference; not a current v9 SDK guide. -->
# Historical Session maintenance

The v8 source baseline is public commit `070b8be3fdabf84501a5acabc3f840ab2dd8eb88` (Agent schema 8). Inspect the scripts and install that checkout's workspace dependencies in a separate checkout before any maintenance; do not replace the current working tree or use live data for validation. Commands below are historical reference and were not rerun against that baseline in this cleanup. Current v9 source rejects the v8 migration and transfer tools with `v8_tool_runtime_version_mismatch` before data access.

The current checkout keeps fixed v7 SQL/strict format checks in `scripts/lib/session-v7-schema.mjs` and a historical bridge in `session-v7-runtime.mjs`. Current protocols are loaded separately by `session-runtime.mjs`. The v7 converter remains an offline tool; it does not make its output readable by the v9 SDK. Its pure codecs are shared with current source, so future protocol changes require revalidation of this converter.

## Full-root v8 migration

Run `scripts/migrate-session-sqlite-v8.mjs` from the version-matched `public` source checkout. It scans every active and archived partition under every Agent; v8 migration cannot be narrowed to one conversation. The default is a read-only preflight:

```bash
node scripts/migrate-session-sqlite-v8.mjs --preflight --root "$HOME/.downcity" --report ./session-v8-preflight.json
```

Planning and row-by-row verification retain records in memory. For an Agent with a large history, use `node --max-old-space-size=12288` in place of `node` to allow a 12 GiB heap when the machine has sufficient memory. After an interruption, resume with the same batch directory and manifests; preserve the existing batch files.

Preflight checks v5/v6/v7 schemas, messages and Parts, fork origins, attachments, SQLite integrity, available space, and blockers. Any `blocked` result prevents the whole apply. After reviewing the report, quit every Desktop, CLI, and Agent writer and run apply with a new batch directory outside the data root:

```bash
node scripts/migrate-session-sqlite-v8.mjs --apply --root "$HOME/.downcity" \
  --batch "$HOME/.downcity-migration/session-v8-20261112" --writers-stopped --report ./session-v8-apply.json
```

Apply acquires the root write lease, makes SQLite-consistent backups including committed WAL, then builds and verifies each database in an isolated staging directory inside its Agent directory so publication uses a rename on the same filesystem. The v8 `ready` marker is written only after every Agent is published and verified. If interrupted, reuse the same `--batch` to resume; `--status` inspects the manifest and `--verify` rechecks backups, targets, and the completion marker. Before the new version performs any business write, `--restore --writers-stopped` can explicitly return to the pre-migration layout. The tool never stops or starts processes or deletes source databases, attachments, or backups.

If an attachment or retained rollback copy runs out of space during copying, original data and the batch manifest remain recoverable. Free space and continue with the same batch; the tool verifies temporary copies before publication and never treats a partial file as complete. Once the new version performs a business write, `--restore` rejects the whole batch because the old backup does not contain those new writes.

Owned attachments are independently copied to `session-files/<storage_id>/attachments/`. Workspace and other Session references keep their addresses and permissions. Valid media disclosure is rebound only after checking the source version; stale disclosure remains stale. If the legacy layout has no reliable archive timestamp, reports explicitly record the original `updated_at` as the migration basis. Known Composer summaries remain in backups and are cleared from the target to be rebuilt by future input; migration never calls a model. `--repair-manifest` accepts the exact repair format below; stale fingerprints or unconsumed entries block the batch.

If a fork source was moved outside the data root, `--recovered-sources PATH` can explicitly include a preserved archive; the tool never searches for or chooses backups automatically. This must be an ordinary JSON file with permissions `0600`, containing only `format_version: 1` and `sources`. Each source contains exactly `agent_id`, `session_id`, `category`, `database_path` (the real absolute preserved database path), `source_fingerprint` (the full original logical fingerprint), and `attachments` (each ordinary attachment's `relative_path`, `bytes`, and `sha256`). These bind the exact reviewed input; database identity must still match. The source is imported as an archived v8 record without restoring a legacy partition, and an existing archive at that address prevents import. Apply and resumed apply require the same repair and recovered-source manifests.

Inspect and verify the original batch, or explicitly restore it before business writes begin:

```bash
node scripts/migrate-session-sqlite-v8.mjs --status --root /path/to/data-root --batch /path/to/private-batch
node scripts/migrate-session-sqlite-v8.mjs --verify --root /path/to/data-root --batch /path/to/private-batch
node scripts/migrate-session-sqlite-v8.mjs --restore --root /path/to/data-root --batch /path/to/private-batch --writers-stopped
```

Owned attachments referenced through a preserved archive's absolute path are also rebound to the imported record UUID using the reviewed attachment inventory. The new record does not keep depending on that archive's owned attachment copy.

## Legacy partition v7 tool

The following tool upgrades individual legacy databases and does not complete the v8 merge. Databases that pass all v8 conversion checks do not require this separate step.

## Preparation and preflight

The tool is `scripts/migrate-session-sqlite-v7.mjs` in the Downcity source repository. Use **Node.js 22.18 or newer** with workspace dependencies installed. Run these commands from the source repository root containing `scripts` and `packages`; enter `public` first in the combined workspace. The source format definition is fixed at v7; codec and stable-prefix validation use the selected checkout.

The default mode is dry-run: source connections are read-only, and conversion plus constraint validation runs in an ephemeral in-memory database. Start with one Session:

```bash
node scripts/migrate-session-sqlite-v7.mjs \
  --root "$HOME/.downcity" \
  --agent example-agent \
  --session example-session \
  --category chat \
  --partition sessions \
  --report ./session-v7-preflight.json
```

You may specify `--dry-run` explicitly. `--root` defaults to `~/.downcity`. `--agent`, `--session`, and `--category` match exactly. `--partition sessions` selects active databases only; `--partition archived-sessions` selects archived databases only. Omitting it scans both. Duplicate Session identities within the selected Agent scope block migration; the tool never chooses one copy automatically. Without filters, the tool scans supported paths: `agents/<agent>/sessions/<category>/<session>/session.db` and the equivalent `archived-sessions` layout. Hidden directories and symlink directories are excluded. An empty selection exits nonzero, so a mistaken scope cannot appear successful.

Source connections use normal SQLite read-only access to include committed WAL. Do not treat a live database as immutable or copy only its main file to make a snapshot. A live dry-run describes each database's read snapshot; apply repeats preflight and checks fingerprints again.

## Explicit repair manifest

Reviewed and approved historical anomalies may be specified with `--repair-manifest PATH`. Dry-run and apply enforce the same strict checks. Use a regular private JSON file with mode `0600`, shaped as `{ "format_version": 1, "databases": [...] }`. Each database entry contains exactly `database_path`, `source_fingerprint`, and `operations`. Paths are complete supported database paths relative to the data root; fingerprints bind the complete, unmodified source snapshot.

```bash
node scripts/migrate-session-sqlite-v7.mjs \
  --dry-run \
  --root "$HOME/.downcity" \
  --repair-manifest ./session-v7-reviewed-repairs.json \
  --report ./session-v7-reviewed-preflight.json
```

A reviewer prepares the manifest from read-only evidence; the tool never approves anomalies automatically. Only these exact operations are supported:

- `renumber_parts`: binds `message_id`, the complete message row's `row_sha256`, and the complete ordered `parts` list. Each Part contains `part_id`, its complete row's `row_sha256`, `source_sequence`, and `target_sequence`. Targets start at 1 and preserve relative order. `evidence` contains the consistent historical backup's `backup_fingerprint` and `missing_interactions`. Each missing position records `source_sequence`, `legacy_part_id`, `legacy_row_sha256`, `tool_part_id`, a zero-based `interaction_index`, and `payload_sha256`. Review must prove from the historical backup that each missing row is an Interaction whose complete payload, excluding Part identity fields, equals a nested Interaction in a current Tool in the same message. Execution checks exact current rows and payload hashes.
- `remove_media_delivery`: contains only `kind`, `message_id`, `part_id`, and the complete Part row's `row_sha256`. It removes only `media_delivery: "tool"` from the specified file with a string `media_version`, recording the removed field and value. Every other field still undergoes full codec validation.
- `historical_inbox`: binds `message_id`, the complete message row's `row_sha256`, the complete ordered `parts` list (each containing only `part_id` and its complete row's `row_sha256`), and `background_tag` (`delegation_result` or `task_result`). It accepts only a visible User message with no meta or fork provenance and the specified context marker. Content order is preserved in a historical Inbox without inventing actor, powers, or callback.

Every operation also requires `kind`. Compute complete row hashes and source logical fingerprints with `digest` and `snapshot_file` exported by `scripts/lib/session-v7-database.mjs`. Keep source snapshots unchanged and never use repaired content to compute a source fingerprint. These records bind exact reviewed evidence and do not authorize broader repairs. Changed source fingerprints require renewed review.

Unknown fields, duplicate databases/operations/Parts/evidence, identity or fingerprint mismatches, and unmatched entries block execution. Every listed database must be in the current selection; narrower filters require a corresponding approved manifest. Unlisted anomalies still block. Manifests and reports contain structural identities; keep them private and out of public documentation and version control.

To apply using the same manifest, append `--repair-manifest ./session-v7-reviewed-repairs.json` to the apply command below. Repairs affect only the planning copy. Original consistency backups, source file identity checks, and fingerprint checks inside the write transaction always use the untouched source snapshot. Report and batch manifests record decisions, original identities/sequences/field values, and mappings in `repairs`; `repair_entry_sha256` binds the manifest entry. Mandatory original backups retain the complete original history.

## Applying offline

Obtain the data owner's approval for the **exact scope**, then fully quit all Desktop, CLI, and Agent processes that could write those databases. The Agent running the current task may itself hold a target database; use an independent terminal. The tool does not stop or start services and cannot establish that every writer has exited.

The following command modifies the selected databases. Run it only after completing those preparations:

```bash
node scripts/migrate-session-sqlite-v7.mjs \
  --apply \
  --root "$HOME/.downcity" \
  --agent example-agent \
  --session example-session \
  --category chat \
  --partition sessions \
  --backup-dir ./session-v7-backups \
  --report ./session-v7-apply.json
```

`--apply` requires `--backup-dir`; backups cannot be bypassed. Each invocation creates a fresh private batch. Original backups use SQLite's consistent backup API, include committed WAL, and are checked against the complete logical fingerprint and a file SHA-256. Original backup files are read-only and never overwritten. The tool transforms and validates a separate working copy before acquiring the source write lock and checking source version, content, and file identity.

Any preflight blocker prevents all source migrations in that selection. After successful preflight, each database commits independently; the batch is not atomic across databases. Lock conflicts, source changes, or failures stop subsequent work. Already committed databases retain their result; remaining databases are explicitly marked as not applied. Without a repair entry for that database, rerunning fully validates and skips existing v7 databases without generating duplicate Inbox entries. A v7 database with a repair entry blocks with `repairs_require_legacy_database`. After interruption, reconcile the batch report with actual database state, remove entries already committed and verified successfully, and preflight the remaining approved entries. Preserve the original manifest and reports for audit. Databases with failed post-commit verification require separate review.

## Data handling

Historical internal inputs and inputs from Session or runtime actors become Inbox Parts in independent Agent messages. Visible inputs from human actors remain User messages. Actor objects, powers, callback, original Message IDs, Turns, message order, timestamps, and fork origin references are retained. Visible inputs without historical accounting remain human messages. Explicit background structure contradicting visibility requires an exact approved historical Inbox operation; otherwise conversion blocks. Unknown or incomplete identities are never invented.

Inbox supports ordered text, context, and file content only. Unsupported content or attachment fields, duplicate identities, gaps in Part order, streaming messages, unexpected schemas, and Interactions without a unique owning Tool in the same message block migration. The tool never guesses Tool or Turn references or silently discards content. Standalone Interactions are folded into their owning Tool, and the manifest records Part identity and nested-position mappings.

Attachment paths, URLs, and media versions remain unchanged. Files are not moved and access is not granted again. Missing or changed attachments continue to follow current read rules. Stable prefixes follow complete Step and terminal-state boundaries without advancing past unfinished content.

Known derived summary tables `composer_adaptive_part_checkpoints` and `composer_sequence_summaries` are cleared and rebuilt by subsequent real inputs. Migration does not call a model. Original summaries remain in backups; the first subsequent turn may require more context and summarization work. Session configuration, Workspace and model bindings, and existing execution identities are preserved. Missing optional tables are created empty.

## Reports and exit codes

The console prints counts and completion status. `--report` saves per-database JSON plans, outcomes, and mappings. Its destination must not exist; choose a new filename for each invocation. Apply batches also maintain their own `report.json` and contain `original/`, `work/`, and `manifests/`. Reports exclude message bodies, callback/powers payloads, and summary content, but contain Session and Part identifiers and should remain private. Original backups contain full history and require appropriate protection.

- `planned`: full dry-run conversion validation passed; no migration has occurred.
- `validated_v7_skipped`: existing v7 structure, constraints, integrity, codec, and stable-prefix checks passed.
- `blocked`: preflight rejected the database; `reason` is a fixed diagnostic code such as `visible_unaccounted_background_input`, `non_contiguous_source_parts`, or `duplicate_session_identity`.
- `not_applied_preflight_blocked`: this database passed, but another selected database blocked application.
- `migrated`: committed and verified using an independent read-only connection.
- `failed`, `not_applied_after_failure`: the failed database and subsequent unapplied databases.
- `committed_pending_verification`, `committed_verification_failed`: a commit occurred, but verification is incomplete or failed. Inspect the database and backup; do not assume rollback.
- `unprocessed`, `backup_work_verified`: intermediate states in persisted reports. After interruption, check actual database versions and backup manifests first.

Top-level `repair_errors` lists unconsumed database entries (`unconsumed_repair_database`). These also block the entire apply batch, marking otherwise planned databases `not_applied_preflight_blocked`. Changed source fingerprints report `repair_source_fingerprint_mismatch`; other identity, evidence, and manifest format failures also use fixed diagnostic codes.

Exit code 0 means the entire selected dry-run passed, or apply completed/validated-skipped every selected database. Blockers, failures, lock conflicts, and empty selections exit nonzero. Review structural and provenance evidence before deciding how to handle a blocked database. Narrowing the scope also requires confirming the actual intended migration range.

## Recovery

Recovery is a separately approved data write. Quit all related writers first. Protect the current database, verify the original backup path, version, logical fingerprint, and SHA-256 in the batch manifest, and restore that consistent original backup to the target path. Handle target WAL/SHM correctly so residual journals cannot be mixed with the restored file. Never replace a database while services still hold connections.

The tool neither restores automatically nor provides a recovery command. A restored v5/v6 database requires a runtime matching that schema; a v7 runtime will still require offline migration. Rehearse recovery in a temporary directory and validate SQLite integrity before deciding on actual recovery and any subsequent service startup.
