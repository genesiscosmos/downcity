<!-- Current independent GroupSession metadata maintenance contract; no implicit runtime access. -->

# GroupSession metadata maintenance

The persistent GroupSession store accepts metadata v2. Every record must contain its own `session_id`, `group_id`, finite nonnegative `created_at`/`updated_at`, and nonnegative integer `message_count`. Reads do not modify metadata. Missing or invalid ownership, required fields, or unsupported versions fail explicitly. Initializing a directory containing history without metadata fails; only a new empty directory can create metadata. Startup may recover summary counters and a truncated final JSONL record after validating metadata. Archiving moves the directory without changing identity.

Run the independent CLI from `public/`. Select one Group storage root containing `sessions/` and/or `archived-sessions/`. Paths must be absolute canonical paths with no symbolic links. Keep application writers stopped for the entire reviewed operation. The flag is an operator declaration, not a service shutdown command.

```sh
node scripts/migrate-group-session-v2.mjs plan --root /data/groups/delivery
node scripts/migrate-group-session-v2.mjs apply --root /data/groups/delivery --expect PLAN_SHA256 --backup /backup/delivery-v2 --writers-stopped
node scripts/migrate-group-session-v2.mjs resume --root /data/groups/delivery --expect PLAN_SHA256 --backup /backup/delivery-v2 --writers-stopped
```

`plan` reads the complete root and prints a deterministic inventory and `plan_hash` to stdout without creating files. Review the identities and retain the hash. `apply` must match that hash; every input is validated before backup creation. Its backup directory must be new, outside the source, and have an existing canonical parent. `resume` requires the original hash and backup. Source changes, including messages, dispatch records, new/deleted files, file permissions or another metadata value, block rather than overwrite.

Conversion accepts v1/v2 metadata only. Both IDs must already be present in metadata; all sessions in the selected root must name the same Group. Encoded session directory names must match their metadata IDs. Every JSONL message must parse and carry the same `group_id`. Missing `group_id` blocks even if a directory or message suggests one. There is no identity override parameter. Invalid optional fields, pending dispatch state, symlinks, special files, and existing runtime locks block. The tool does not truncate or repair logs.

A v1 record changes only `v` to `2` and supplies an empty `pending_message_ids` if that optional checkpoint is absent. It preserves permanent/session/member IDs, original message bytes, dispatch logs, unknown metadata fields and all other files. Valid v2 metadata remains byte-for-byte unchanged. No Agent database, Tool evidence, or transfer package is opened or changed.

The private backup contains `source/` with the original tree and `manifest.json` binding its inventory and planned hashes. It is retained after success. Metadata publication uses fsynced files and per-file atomic renames; the batch is not globally atomic. Ordinary errors release the migration lease and preserve the backup. Repeating `resume` accepts each file only at its original or exact planned target hash, allowing publication interrupted between files or after a rename to finish safely. Business writes after conversion block resume.

A process crash may leave `.group-session-v2.lock` in the source root and a `.group-v2-*.tmp` beside a metadata file. These cause a fail-closed preflight. Confirm that writers and migrators are stopped, review the backup manifest, and remove only that abandoned migration lease and any staging file whose bytes match the target hash for that exact metadata path before resuming. The tool never removes runtime locks automatically. A backup without `manifest.json` has not published changes: retain it for inspection and use a new backup path. There is no automatic rollback command; restoring original data is a separate stopped-writer operation requiring review of subsequent writes. Do not copy a backup over live data.

The lease serializes migrations, not normal application writers. Stopped writers and exclusive operator access are required throughout; hash checks cannot make concurrent business writes safe. Backup storage must support regular files, fsync and the source filesystem must support atomic rename. Filesystem or hardware failure still requires operator recovery from the retained backup.
