/** Memory Session 的 Profile 精确编辑暂存工具；仅校验证据和版本，不写入 Profile。 */
import { z } from "zod";
import type { AgentTool } from "@downcity/type";
import type { MemoryJobChangeDetail } from "../types/MemoryJob.js";
import { MEMORY_SESSION_KIND } from "../types/MemorySession.js";
import { assert_memory_job_detail_budget, memory_job_source_excerpts, memory_source_excerpt_schema, type MemoryJobSnapshotCache } from "./MemoryJobDetail.js";
import type { MemoryJobStore } from "../storage/MemoryJobStore.js";
import { apply_profile_edits } from "./MemoryProfile.js";

/** Profile 暂存所需的最小宿主端口。 */
export interface ProfileStageToolOptions {
  /** 当前 Power 的持久化 Job 账本，实际 Job 由工具调用身份绑定。 */
  jobs: MemoryJobStore;
  /** 当前工具实例实际返回给此 Session 的固定读取快照。 */
  snapshots: MemoryJobSnapshotCache;
}

const profile_stage_schema = z.object({
  expected_version: z.string().regex(/^[a-f0-9]{64}$/u),
  edits: z.array(z.object({ old_text: z.string().min(1).max(64_000), new_text: z.string().max(64_000) }).strict()).min(1).max(32),
  source_ids: z.array(z.string().min(1)).min(1).max(100),
  source_excerpts: z.array(memory_source_excerpt_schema).min(1).max(100),
}).strict();

/** 创建 memory_stage_profile 工具；当前 Session 只能为自己持有的运行中 Job 暂存一次结果。 */
export function create_profile_stage_tool(options: ProfileStageToolOptions): AgentTool {
  return {
    description: "Stage exact Profile edits against the version read from memory_sources. Cite source_ids and source_excerpts with exact original quotes for every cited source. This does not commit. Preserve source markers and finish after staging. If the read snapshot is unavailable, call memory_sources again.",
    input_schema: z.toJSONSchema(profile_stage_schema),
    execute: async (input, context) => {
      const { expected_version, edits, source_ids, source_excerpts } = profile_stage_schema.parse(input);
      const job_id = context.session_origin.memory_job_id;
      if (context.session_origin.type !== MEMORY_SESSION_KIND || typeof job_id !== "string") throw new Error("Profile staging requires a Memory Session");
      const job = await options.jobs.read(job_id);
      if (!job || job.access.agent_id !== context.agent_id || job.session_id !== context.session_id || job.status !== "running") {
        throw new Error("Memory Session does not own this active Job");
      }
      if (job.mode !== "profile") throw new Error("Profile staging requires a Profile Job");
      if (job.changes || job.profile_edits || job.skip_reason) throw new Error("Job already has a staged outcome");
      const allowed_sources = new Set(job.sources.map((source) => source.source_id));
      if (source_ids.some((source_id) => !allowed_sources.has(source_id))) throw new Error("Unknown original source");
      const content_size = edits.reduce((total, edit) => total + edit.old_text.length + edit.new_text.length, 0);
      if (content_size > 64_000) throw new Error("Profile edit budget exceeded");
      if (edits.some((edit) => edit.old_text.includes("<!-- memory-source:") || edit.new_text.includes("<!-- memory-source:"))) {
        throw new Error("Profile edits cannot modify source markers");
      }
      const { snapshot, captured_at } = options.snapshots.read(job, "profile", expected_version);
      apply_profile_edits(snapshot.content, edits);
      const sources = memory_job_source_excerpts(job, source_ids, source_excerpts);
      const change_details: MemoryJobChangeDetail[] = edits.map((edit, index) => ({
        operation: "profile_edit", topic: `核心记忆编辑 ${index + 1}`, expected_version,
        before: { content: edit.old_text, version: expected_version },
        after: { content: edit.new_text }, captured_at, sources,
      }));
      assert_memory_job_detail_budget(change_details);
      await options.jobs.stage(job.job_id, context.session_id, {
        profile_version: expected_version,
        profile_edits: { edits, source_ids }, change_details,
      });
      options.snapshots.clear();
      return { staged: true, count: edits.length, committed: false };
    },
  };
}
