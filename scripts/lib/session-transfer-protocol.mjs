/**
 * Current single-session transfer contract. Package and import-batch versions are
 * independent from DB, disclosure, ResultRef and attachment ownership versions.
 * Historical packages are accepted only by explicit isolated offline converters.
 */
export const transfer_schema_version = 14;
export const transfer_package_version = 3;
export const transfer_batch_version = 3;

/** Reject a historical bridge before any current package or batch is read/written. */
export function assert_transfer_runtime(runtime) {
  if (runtime.AGENT_SESSION_SCHEMA_VERSION !== transfer_schema_version) throw new Error("transfer_runtime_version_mismatch");
}
