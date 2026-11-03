/**
 * Memory Job 差异的固定读取快照与授权证据摘录。
 * 快照仅记录专用工具已经返回给当前 Session 的版本；暂存不查询当前正文。
 * 运行恢复后若内存快照不存在，模型必须重新读取，不能把当前值冒充旧值。
 */
import { z } from "zod";
import type { MemoryRecord } from "../types/Memory.js";
import type { MemoryJob, MemoryJobChangeDetail, MemoryJobContentSnapshot, MemoryJobSourceExcerpt } from "../types/MemoryJob.js";
import type { ProfileDocument } from "../types/Profile.js";

/** 模型只能引用输入包内真实存在的连续原文；宿主另行核验出处。 */
export const memory_source_excerpt_schema = z.object({
  source_id: z.string().min(1),
  excerpt: z.string().min(1).max(700),
}).strict();

/** 一次实际读取所固定的正文及时间。 */
export interface MemoryJobReadSnapshot {
  /** 工具已返回给模型的正文与精确版本。 */
  snapshot: MemoryJobContentSnapshot;
  /** 实际读取时的 ISO 8601 时间。 */
  captured_at: string;
}

/** 一个来源的精确引用输入；不允许模型自行填写角色或定位信息。 */
export interface MemorySourceExcerptInput {
  /** 已授权输入包中的来源编号。 */
  source_id: string;
  /** 必须能在该来源中连续、精确匹配的原文。 */
  excerpt: string;
}

/** 工具实例内的有界快照缓存；键同时绑定 Job、Session、正文与版本。 */
export class MemoryJobSnapshotCache {
  /** 只保存真实读取值；移出预算后需要模型重新读取。 */
  private readonly snapshots = new Map<string, MemoryJobReadSnapshot>();
  /** 当前正文字符总量，限制长 Session 的内存占用。 */
  private content_size = 0;

  /** 固定 memory_read 实际返回的知识正文，不接收模型提供的旧值。 */
  capture_memory(job: MemoryJob, memory: MemoryRecord): void {
    if (!memory.version) return;
    this.capture(job, memory.memory_id, { content: memory.content, version: memory.version, validity: memory.validity ?? "active" });
  }

  /** 固定 memory_sources 实际返回的完整 Profile，供精确编辑匹配。 */
  capture_profile(job: MemoryJob, profile: ProfileDocument): void {
    this.capture(job, "profile", { content: profile.content, version: profile.version });
  }

  /** 只取当前尝试曾读取的指定版本；缓存缺失时禁止退回当前版本。 */
  read(job: MemoryJob, memory_id: string, version: string): MemoryJobReadSnapshot {
    const value = this.snapshots.get(this.key(job, memory_id, version));
    if (!value) throw new Error("Read this exact version in the current Memory Session before staging; the read snapshot is unavailable");
    return { snapshot: { ...value.snapshot }, captured_at: value.captured_at };
  }

  /** 成功暂存后释放当前工具实例的快照。 */
  clear(): void { this.snapshots.clear(); this.content_size = 0; }

  /** 精确身份与版本组成不含歧义的缓存键。 */
  private key(job: MemoryJob, memory_id: string, version: string): string {
    return JSON.stringify([job.job_id, job.session_id, memory_id, version]);
  }

  /** 固定正文值，并按插入顺序移除超预算的旧快照。 */
  private capture(job: MemoryJob, memory_id: string, snapshot: MemoryJobContentSnapshot): void {
    const key = this.key(job, memory_id, snapshot.version!);
    const previous = this.snapshots.get(key);
    if (previous) this.content_size -= previous.snapshot.content.length;
    this.snapshots.delete(key);
    this.snapshots.set(key, { snapshot: { ...snapshot }, captured_at: new Date().toISOString() });
    this.content_size += snapshot.content.length;
    while (this.snapshots.size > 64 || this.content_size > 1_000_000) {
      const first = this.snapshots.entries().next().value;
      if (!first) break;
      this.content_size -= first[1].snapshot.content.length;
      this.snapshots.delete(first[0]);
    }
  }
}

/** 校验并复制具体原文摘录；所有角色与 Session 定位均取自已授权的来源包。 */
export function memory_job_source_excerpts(
  job: MemoryJob,
  source_ids: string[],
  excerpts: MemorySourceExcerptInput[],
): MemoryJobSourceExcerpt[] {
  const cited_ids = new Set(source_ids);
  if (!cited_ids.size || cited_ids.size !== source_ids.length) throw new Error("Source IDs must be nonempty and unique");
  const supplied_ids = new Set(excerpts.map((item) => item.source_id));
  if (cited_ids.size !== supplied_ids.size || [...cited_ids].some((source_id) => !supplied_ids.has(source_id))) {
    throw new Error("Every cited source requires an exact original excerpt");
  }
  return excerpts.map(({ source_id, excerpt }) => {
    const source = job.sources.find((item) => item.source_id === source_id);
    if (!source || !cited_ids.has(source_id)) throw new Error("Unknown original source");
    const excerpt_start = source.text.indexOf(excerpt);
    if (excerpt_start < 0) throw new Error("Source excerpt must exactly match the authorized original text");
    return {
      source_id, agent_id: source.agent_id, category: source.category,
      session_id: source.session_id, message_id: source.message_id, role: source.role,
      excerpt, excerpt_start, truncated: excerpt.length !== source.text.length,
    };
  });
}

/** 限制整批详情持久化的正文与证据预算，不截断需要审计的 before/after。 */
export function assert_memory_job_detail_budget(changes: MemoryJobChangeDetail[]): void {
  const source_size = changes.reduce((total, change) => total + change.sources.reduce((count, source) => count + source.excerpt.length, 0), 0);
  const content_size = changes.reduce((total, change) => total + (change.before?.content.length ?? 0) + change.after.content.length, 0);
  if (source_size > 24_000 || content_size > 512_000) throw new Error("Memory Job detail budget exceeded; stage a smaller change set");
}
