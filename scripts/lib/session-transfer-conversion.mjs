/**
 * 显式历史包转换为当前 format3/schema13；历史格式由冻结协议独立校验。
 * parsing stays isolated; current import never branches on old contracts. Missing
 * first-disclosure evidence blocks before the requested output directory is created.
 * Source packages are never changed, and manifest source paths are never opened.
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { load_runtime as load_historical } from "./session-v9-runtime.mjs";
import { load_runtime as load_v10 } from "./session-v10-runtime.mjs";
import { load_runtime as load_v11 } from "./session-v11-runtime.mjs";
import { load_runtime as load_v12 } from "./session-v12-runtime.mjs";
import { convert_record as convert_v12_record } from "./session-v12-conversion.mjs";
import { convert_record } from "./session-descriptor-conversion.mjs";
import { record_sources } from "./session-transfer-sources.mjs";
import { convert_v8_package } from "./session-transfer-legacy.mjs";
import { load_package as load_v9_package } from "./session-v9-transfer-package.mjs";
import { inspect_record, terminal_policy } from "./session-v10-proof.mjs";
import { validate_record, uuid_pattern } from "./session-transfer-record.mjs";
import { inventory, load_package, load_protocol_package, package_request_hash } from "./session-transfer-package.mjs";
import { assert_transfer_runtime, transfer_schema_version, transfer_package_version } from "./session-transfer-protocol.mjs";
import { digest, fail } from "./session-v7-database.mjs";
import { attachment_inventory, copy_attachments, exists, ordinary, save_json, file_hash } from "./session-v8-files.mjs";

/** Convert only a complete proven package into a new path, retaining all saved snapshots. */
export async function convert_legacy_package(input, runtime) {
  assert_transfer_runtime(runtime);
  if (!input.package_path || !input.output_path || !uuid_pattern.test(input.operation_id ?? "")) fail("transfer_legacy_explicit_parameters_required");
  const source_path = fs.realpathSync(input.package_path); ordinary(source_path, true);
  const output_path = runtime.resolve_resource_root(input.output_path);
  if (output_path === source_path || output_path.startsWith(`${source_path}${path.sep}`) || source_path.startsWith(`${output_path}${path.sep}`)) fail("transfer_package_overlap");
  if (exists(output_path)) fail("output_already_exists");
  const manifest_path = path.join(source_path, "manifest.json"); const stat = ordinary(manifest_path);
  if (stat.size > 256 * 1024 * 1024 || stat.mode & 0o077) fail("transfer_package_permissions_or_budget");
  const original_manifest_hash = file_hash(manifest_path);
  const header = JSON.parse(fs.readFileSync(manifest_path, "utf8"));
  const source_is_v10 = header.format_version === 3 && header.schema_version === 10;
  const source_is_v11 = header.format_version === 3 && header.schema_version === 11;
  const source_is_v12 = header.format_version === 3 && header.schema_version === 12;
  const historical = source_is_v12 ? await load_v12() : source_is_v11 ? await load_v11() : source_is_v10 ? await load_v10() : await load_historical();
  const read_package = source_is_v10 || source_is_v11 || source_is_v12 ? load_protocol_package : load_v9_package;
  let temporary; let package_path = source_path; let cleared_composer_checkpoints = 0;
  try {
    if (header.format_version === 1 && header.schema_version === 8) {
      temporary = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "downcity-package-v13-")));
      package_path = path.join(temporary, "schema9");
      const converted = convert_v8_package({ ...input, package_path: source_path, output_path: package_path }, historical);
      cleared_composer_checkpoints = converted.cleared_composer_checkpoints;
    } else if (!source_is_v10 && !source_is_v11 && !source_is_v12 && (header.format_version !== 2 || header.schema_version !== 9)) fail("transfer_legacy_package_version_unsupported");
    const { manifest, record, fingerprint } = read_package(package_path, historical);
    const converted_record = convert_record(source_is_v12 ? record : convert_v12_record(record), runtime);
    const proof = inspect_record(converted_record, manifest.agent_id, runtime);
    if (proof.blockers.length) {
      const error = new Error("v10_first_disclosure_unproven"); error.blockers = proof.blockers; throw error;
    }
    validate_record(converted_record, manifest.agent_id, runtime);
    const planned = { ...manifest, format_version: transfer_package_version, schema_version: transfer_schema_version, export_operation_id: input.operation_id, status: "copying" };
    planned.sources = record_sources(converted_record, { ...runtime, agent_id: manifest.agent_id });
    planned.record_sha256 = digest(converted_record);
    planned.request_hash = package_request_hash(planned);
    if (file_hash(manifest_path) !== original_manifest_hash || read_package(package_path, historical).fingerprint !== fingerprint) fail("transfer_source_package_changed");
    fs.mkdirSync(output_path, { mode: 0o700 }); save_json(path.join(output_path, "manifest.json"), planned);
    save_json(path.join(output_path, "record.json"), converted_record);
    copy_attachments(path.join(package_path, "attachments"), path.join(output_path, "attachments"), inventory(manifest.attachments));
    if (digest(attachment_inventory(path.join(package_path, "attachments"))) !== digest(inventory(manifest.attachments))
      || file_hash(manifest_path) !== original_manifest_hash || read_package(package_path, historical).fingerprint !== fingerprint) fail("transfer_source_package_changed");
    save_json(path.join(output_path, "manifest.json"), { ...planned, status: "ready" }, true);
    load_package(output_path, runtime);
    return { status: "converted", session_id: record.metadata.session_id, terminal_policy,
      preserved_tool_snapshots: proof.tools.filter(tool => tool.evidence === "saved-complete-snapshot").length,
      cleared_composer_checkpoints };
  } finally { if (temporary) fs.rmSync(temporary, { recursive: true, force: true }); }
}
