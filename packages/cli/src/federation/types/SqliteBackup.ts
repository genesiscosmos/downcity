/**
 * Local SQLite backup and restore contracts. Metadata contains identities and
 * checksums only; database contents and runtime secrets never enter CLI output.
 */

/** Completed, self-contained SQLite snapshot; backup.json is the completion marker. */
export interface SqliteBackupMetadata {
  /** Backup format version; unknown formats are rejected before SQLite is opened. */
  schema: 1;
  /** Unique directory identity, independent of release and application versions. */
  backup_id: string;
  /** Exact owning Federation identity; cross-Federation restore is forbidden. */
  fed_id: string;
  /** UTC ISO timestamp when snapshot creation began. */
  created_at: string;
  /** Installed application version recorded by the verified release manifest. */
  app_version: string;
  /** Installed release identity at backup time; restoring does not switch releases. */
  release_id: string;
  /** Reason for creation; safety snapshots preserve the database before a restore. */
  purpose: "explicit" | "before_restore";
  /** Fixed snapshot basename; metadata cannot redirect reads to arbitrary files. */
  database_file: "database.sqlite";
  /** Exact byte length of the completed, offline snapshot. */
  size_bytes: number;
  /** SHA-256 of database.sqlite after conversion to a standalone rollback-journal database. */
  sha256: string;
  /** Successful full SQLite PRAGMA integrity_check result, rechecked during restore. */
  integrity_check: "ok";
}

/** Verified snapshot location and metadata, never a runtime configuration or secret. */
export interface SqliteBackup {
  /** Absolute backup directory containing both completed files. */
  backup_dir: string;
  /** Absolute path of the checked standalone SQLite snapshot. */
  database_path: string;
  /** Validated completion metadata bound to this Federation and database digest. */
  metadata: SqliteBackupMetadata;
}

/** Minimal inputs needed to create an online snapshot from a registered database. */
export interface SqliteBackupSource {
  /** Exact Federation identity used for ownership and the private backup directory. */
  fed_id: string;
  /** Absolute existing database path from persisted runtime DATABASE_PATH only. */
  database_path: string;
  /** Verified installed application version to include in snapshot metadata. */
  app_version: string;
  /** Verified installed release ID to include in snapshot metadata. */
  release_id: string;
}

/** Explicit command options; target selection follows the existing one-shot selector. */
export interface FederationBackupOptions {
  /** Exact registered Federation ID, mutually exclusive with name. */
  id?: string;
  /** Exact registered Federation name, mutually exclusive with id. */
  name?: string;
}

/** Restore controls; dry_run performs read-only preflight without creating a safety snapshot. */
export interface FederationRestoreOptions extends FederationBackupOptions {
  /** Backup directory or its database.sqlite file; backup.json is always required. */
  path: string;
  /** Explicit authorization to replace the selected stopped Federation's database. */
  yes?: boolean;
  /** Inspect ownership, digest, integrity, paths and manager stop facts without writing. */
  dry_run?: boolean;
}

/** Preview facts passed to the CLI confirmation before the atomic database replacement. */
export interface SqliteRestorePreview {
  /** Backup selected by the caller, fully checked against the owning Federation. */
  backup: SqliteBackup;
  /** Absolute deployed database path that will be atomically replaced. */
  database_path: string;
  /** Completed current-database safety backup; absent during read-only dry runs. */
  safety_backup?: SqliteBackup;
}

/** Restore completion facts; cancellation retains the safety backup without replacing data. */
export interface SqliteRestoreResult extends SqliteRestorePreview {
  /** True only after atomic replacement and the registry's stopped status were saved. */
  restored: boolean;
}

/** Injectable UI boundary, allowing isolated verification without a terminal or service mutation. */
export interface SqliteRestoreInteraction {
  /** Display only identities and paths; return true only for explicit replacement approval. */
  confirm: (preview: SqliteRestorePreview) => Promise<boolean>;
}
