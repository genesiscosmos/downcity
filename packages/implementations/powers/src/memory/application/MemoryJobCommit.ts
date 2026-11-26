/** 将唯一 stage 的来源选择重新绑定到 Job 固定证据；不采信模型生成的身份、角色或旧正文。 */
import type { MemoryJob } from "../types/MemoryJob.js";
import type { MemoryChange } from "../types/MemoryTransaction.js";
import { capture_memory_source } from "./MemorySourceBinding.js";

/** 只有固化证据的 Job 可提交，旧 stage 不直接重放。 */
export function memory_job_changes(job: MemoryJob): MemoryChange[] {
  if (!job.changes?.length || !job.change_details || job.changes.length !== job.change_details.length) throw new Error("Memory Job has no complete staged change set");
  return job.changes.map((change, index): MemoryChange => {
    const detail = job.change_details![index]!;
    const sources = change.source_ids.map((source_id) => {
      const source = job.sources.find((item) => item.source_id === source_id);
      const evidence = detail.sources.find((item) => item.source_id === source_id);
      if (!source?.bound_source || !evidence || source.text.slice(evidence.excerpt_start, evidence.excerpt_start + evidence.excerpt.length) !== evidence.excerpt) throw new Error("Staged source has no matching bound evidence");
      const original = source.bound_source;
      let locator = original.locator;
      if (locator && "message_id" in locator) {
        locator = { ...locator, start_offset: locator.start_offset + evidence.excerpt_start,
          end_offset: locator.start_offset + evidence.excerpt_start + evidence.excerpt.length };
      }
      if (locator && "event_id" in locator && locator.output_range) {
        locator = { ...locator, output_range: { start: locator.output_range.start + evidence.excerpt_start, end: locator.output_range.start + evidence.excerpt_start + evidence.excerpt.length }, truncated: locator.truncated || evidence.excerpt.length < source.text.length };
      }
      return capture_memory_source({ source_type: original.source_type, role: original.role, locator,
        excerpt: evidence.excerpt, note: original.note }, evidence.excerpt);
    });
    if (change.operation === "create") {
      if (change.kind !== job.memory_kind || job.kind === "revise") throw new Error("Staged create violates Job binding");
      return change.kind === "agreement" ? { operation: "create", kind: change.kind, content: change.content!, sources }
        : { operation: "create", kind: "knowledge", content: change.content!, title: change.title!, sources };
    }
    if (!change.memory_id || !change.expected_version || detail.before?.version !== change.expected_version) throw new Error("Staged update has no fixed read version");
    if (job.kind === "revise" && (change.memory_id !== job.memory_id || change.expected_version !== job.expected_version)) throw new Error("Revision escaped its bound object/version");
    if (change.operation === "update") return { operation: change.operation, memory_id: change.memory_id, expected_version: change.expected_version,
      content: change.content!, ...(change.title !== undefined ? { title: change.title } : {}), sources };
    if (change.operation !== "invalidate") throw new Error("No explicit deletion authorization for Job");
    return { operation: change.operation, memory_id: change.memory_id, expected_version: change.expected_version, sources };
  });
}
