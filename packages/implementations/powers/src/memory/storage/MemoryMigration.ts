/** 显式一次性迁移工具：纯预览、不自动扫描、完整覆盖核对、停写屏障中的单范围原子发布。 */
import type { MemoryMigrationMaterial, MemoryMigrationCandidate, MemoryMigrationPreview, MemoryMigrationPublishInput, MemoryMigrationPreservation } from "../types/MemoryMigration.js";
import type { MemoryScope, MemoryRecord, MemorySource } from "../types/MemoryRecord.js";
import type { MemoryScopeManifest, MemoryRecordPointer } from "../types/MemoryTransaction.js";
import { validate_memory_content } from "../runtime/MemorySchema.js";
import { canonical_memory_json, memory_hash, memory_manifest_key, validate_sources } from "./MemoryRecordStore.js";

/** 不读取外部文件，也不把原始多规则 Profile 盲拆为候选。 */
export function preview_memory_migration(scope: MemoryScope, materials: MemoryMigrationMaterial[], candidates: MemoryMigrationCandidate[], preservation?: MemoryMigrationPreservation): MemoryMigrationPreview {
  const frozen = structuredClone({ scope, materials, candidates, preservation: preservation ?? { complete: materials.length === 0, history_snapshots: [], suppressions: [] } });
  const coverage: Record<string, number[]> = {};
  const blockers: string[] = [];
  if (!["agent", "user", "workspace"].includes(scope.type) || !scope.id || (scope.type === "agent" && !/^[a-z0-9_]+$/u.test(scope.id))) blockers.push("Invalid migration scope identity");
  if (!frozen.preservation.complete) blockers.push("Complete legacy history and suppression coverage must be reviewed");
  for (const suppression of frozen.preservation.suppressions) {
    if (!suppression.memory_id || !suppression.version || !/^[a-f0-9]{64}$/u.test(suppression.content_hash) || !["update", "delete", "invalidate"].includes(suppression.reason)) blockers.push("Invalid legacy suppression");
  }
  if (new Set(materials.map((item) => item.legacy_id)).size !== materials.length) blockers.push("Duplicate legacy material identity");
  for (const material of frozen.materials) {
    coverage[material.legacy_id] = [];
    if (!material.legacy_id || !material.original_text) blockers.push("Empty migration material");
    if (!["active", "invalidated", "deleted"].includes(material.state)) blockers.push(`Invalid legacy state: ${material.legacy_id}`);
    if (!material.scope) blockers.push(`Scope requires human resolution: ${material.legacy_id}`);
    if (material.scope && canonical_memory_json(material.scope) !== canonical_memory_json(scope)) blockers.push(`Scope requires human resolution: ${material.legacy_id}`);
    if (material.scheduled_validity) blockers.push(`Scheduled validity requires a separate approved contract: ${material.legacy_id}`);
  }
  for (const [index, candidate] of frozen.candidates.entries()) {
    if (!["active", "invalidated", "deleted"].includes(candidate.state)) blockers.push(`Invalid candidate state: ${index}`);
    if (!candidate.reviewed || !candidate.review_note.trim()) blockers.push(`Candidate ${index} has not been fully reviewed`);
    try { validate_memory_content(candidate.content.kind, candidate.content.content, candidate.content.title); }
    catch { blockers.push(`Candidate ${index} has invalid or over-budget content/title`); }
    if (scope.type === "workspace" && candidate.content.kind === "agreement") blockers.push(`Workspace Agreement is unsupported: ${index}`);
    if (!candidate.legacy_ids.length) blockers.push(`Candidate ${index} has no original material`);
    for (const legacy_id of candidate.legacy_ids) {
      const original = frozen.materials.find((material) => material.legacy_id === legacy_id);
      if (!original) { blockers.push(`Unknown legacy material: ${legacy_id}`); continue; }
      coverage[legacy_id]!.push(index);
      if (original.state !== "active" && candidate.state === "active") blockers.push(`Candidate ${index} reactivates a tombstone`);
    }
    if (candidate.preserve_memory_id && (!candidate.preserve_memory_id.includes("/wiki/") || candidate.preserve_memory_id.includes(".."))) blockers.push(`Invalid preserved identity: ${index}`);
  }
  for (const material of frozen.materials) if (!coverage[material.legacy_id]?.length) blockers.push(`Uncovered material: ${material.legacy_id}`);
  return { ...frozen, input_hash: memory_hash(canonical_memory_json(frozen.materials)), coverage, blockers };
}
/** 人工审阅必须固定全部材料、候选、scope 及覆盖清单。 */
export function memory_migration_preview_hash(preview: MemoryMigrationPreview): string { return memory_hash(canonical_memory_json(preview)); }

/** 不补造历史角色；保留原始材料作为 legacy_snapshot，确认保留不是原始用户授权证据。 */
function migration_source(material: MemoryMigrationMaterial, now: string): MemorySource {
  return { source_id: `legacy_${memory_hash(material.legacy_id + material.original_text)}`, source_type: "legacy_snapshot", role: "unknown",
    content_hash: `sha256:${memory_hash(material.original_text)}`, captured_at: now, excerpt: material.original_text,
    locator: { snapshot_id: `snapshot_${memory_hash(material.legacy_id + material.original_text)}` }, note: "Imported original material; unavailable historical user identity is not reconstructed" };
}
/** 本函数不停止服务；调用者必须显式持有旧 runtime 全范围停写屏障及人工授权。 */
export async function publish_memory_migration(input: MemoryMigrationPublishInput) {
  if (input.authorization !== "explicit_management_migration" || typeof input.with_write_barrier !== "function") throw new Error("Explicit migration authorization and host write barrier are required");
  const preview = preview_memory_migration(input.preview.scope, input.preview.materials, input.preview.candidates, input.preview.preservation);
  if (memory_migration_preview_hash(preview) !== input.expected_preview_hash) throw new Error("MIGRATION_PREVIEW_CHANGED");
  if (preview.blockers.length) throw new Error(`MIGRATION_BLOCKED: ${preview.blockers.join("; ")}`);
  if (!preview.materials.length && !input.confirmed_empty) throw new Error("Empty scope must be explicitly confirmed");
  if (preview.materials.length && input.confirmed_empty) throw new Error("Nonempty material cannot be marked empty");
  const scope = preview.scope;
  const expected_prefix = scope.type === "agent" ? `agent/${scope.id}` : `${scope.type}/${Buffer.from(scope.id, "utf8").toString("hex")}`;
  if (input.scope_prefix !== expected_prefix || input.scope_prefix.includes("..")) throw new Error("Migration scope prefix mismatch");
  return await input.with_write_barrier(async () => await input.storage.with_scope_lock(memory_manifest_key(input.scope_prefix), async () => {
    if (await input.storage.has(memory_manifest_key(input.scope_prefix))) throw new Error("Scope already activated; migration cannot overwrite new writes");
    const now = new Date().toISOString();
    const records: Record<string, MemoryRecordPointer> = {};
    const manifest: MemoryScopeManifest = { schema_version: 2, activation: input.confirmed_empty ? "confirmed_empty" : "migrated", scope,
      scope_prefix: input.scope_prefix, scope_version: "0", records, history: {}, receipts: {}, suppressions: structuredClone(preview.preservation.suppressions) };
    const mappings: Record<string, { memory_id: string; version: string }[]> = {};
    for (const [index, candidate] of preview.candidates.entries()) {
      const memory_id = candidate.preserve_memory_id ?? `${input.scope_prefix}/wiki/${memory_hash(`${preview.input_hash}:${index}`)}`;
      if (!memory_id.startsWith(`${input.scope_prefix}/wiki/`) || records[memory_id]) throw new Error("Invalid or duplicate migrated identity");
      const materials = candidate.legacy_ids.map((legacy_id) => preview.materials.find((material) => material.legacy_id === legacy_id)!);
      const sources = materials.flatMap((material) => {
        let retained: MemorySource[] = [];
        if (material.sources?.length) { try { validate_sources(material.sources, false); retained = material.sources; } catch { /* 无法核验的旧来源只保存在原始审计中。 */ } }
        return [...retained, migration_source(material, now)];
      });
      // 迁移确认只证明本次选择保留的完整条目；原始证据缺失仍在 legacy_snapshot 中明确保留。
      if (candidate.content.kind === "agreement" && candidate.state === "active") {
        const excerpt = canonical_memory_json({ content: candidate.content.content, review_note: candidate.review_note, action: "retain_reviewed_agreement" });
        sources.push({ source_id: `review_${memory_hash(excerpt)}`, source_type: "management_input", role: "user", content_hash: `sha256:${memory_hash(excerpt)}`,
          captured_at: now, excerpt, locator: { operation_id: `migration:${input.expected_preview_hash}:${index}` }, note: "Current authenticated migration review, not historical user testimony" });
      }
      validate_sources(sources, candidate.content.kind === "agreement" && candidate.state === "active");
      const version = `migration:${input.expected_preview_hash}:${index}`;
      const record: MemoryRecord = { ...candidate.content, memory_id, version, state: candidate.state, scope, sources, created_at: now, updated_at: now };
      const text = canonical_memory_json(record);
      const key = `${input.scope_prefix}/runtime/records/versions/${memory_hash(memory_id)}/${memory_hash(version)}.json`;
      await input.storage.write(key, text);
      records[memory_id] = { key, hash: memory_hash(text), version, state: record.state };
      for (const legacy_id of candidate.legacy_ids) (mappings[legacy_id] ??= []).push({ memory_id, version });
      if (record.state !== "active") manifest.suppressions.push({ memory_id, version, content_hash: memory_hash(record.content.replace(/\r\n?/gu, "\n").trim()), sources, reason: record.state === "deleted" ? "delete" : "invalidate" });
    }
    const receipt = { status: "committed", scope, input_hash: preview.input_hash, preview_hash: input.expected_preview_hash,
      committed_at: now, mappings, count: preview.candidates.length, coverage: preview.coverage };
    // 审计和旧材料先落盘，最后发布唯一可见性标记；失败只留下未引用的可回收文件。
    await input.storage.write(`${input.scope_prefix}/runtime/records/migration/${input.expected_preview_hash}.json`, canonical_memory_json({ receipt, preview }));
    await input.storage.write(memory_manifest_key(input.scope_prefix), canonical_memory_json(manifest));
    return receipt;
  }));
}
