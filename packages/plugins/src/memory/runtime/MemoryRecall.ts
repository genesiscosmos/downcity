/**
 * Builtin Memory Provider 的确定性文本召回算法。
 *
 * 关键点（中文）
 * - 只负责 query 分词、内容切片和相关性评分。
 * - 不读取 Store，不处理 owner/subject 权限，也不持有运行时状态。
 */

import type { MemoryRecord } from "@/memory/types/Memory.js";
import type { BuiltinMemoryChunk } from "@/memory/types/BuiltinMemoryProvider.js";

const CHUNK_MAX_CHARS = 1_600;
const CHUNK_OVERLAP_CHARS = 240;

/** 把查询文本拆成有界 token。 */
export function tokenize_memory_query(raw: string): string[] {
  return String(raw || "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}_-]+/gu, " ")
    .split(/\s+/)
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 16);
}

/** 计算片段的确定性覆盖率和密度分数。 */
export function score_memory_chunk(text: string, tokens: string[]): number {
  if (tokens.length === 0) return 0;
  const normalized = String(text || "").toLowerCase();
  let matched_tokens = 0;
  let total_hits = 0;
  for (const token of tokens) {
    let hits = 0;
    let start_index = 0;
    while (start_index < normalized.length) {
      const found_index = normalized.indexOf(token, start_index);
      if (found_index < 0) break;
      hits += 1;
      start_index = found_index + token.length;
    }
    if (hits > 0) {
      matched_tokens += 1;
      total_hits += Math.min(hits, 4);
    }
  }
  if (matched_tokens === 0) return 0;
  const coverage = matched_tokens / tokens.length;
  const density = Math.min(total_hits, tokens.length * 3) / (tokens.length * 3);
  return Number((coverage * 0.75 + density * 0.25).toFixed(4));
}

/** 把完整记录切分成带行号的有界片段。 */
export function chunk_memory_record(memory: MemoryRecord): BuiltinMemoryChunk[] {
  const lines = memory.content.replace(/\r\n/g, "\n").split("\n");
  const chunks: BuiltinMemoryChunk[] = [];
  let bucket: Array<{ line: string; line_number: number }> = [];
  let character_count = 0;

  const flush = (): void => {
    const text = bucket.map((item) => item.line).join("\n").trim();
    if (!text || bucket.length === 0) return;
    chunks.push({
      memory,
      start_line: bucket[0]?.line_number ?? 1,
      end_line: bucket[bucket.length - 1]?.line_number ?? 1,
      text,
    });
  };

  const carry_overlap = (): void => {
    let size = 0;
    const next: Array<{ line: string; line_number: number }> = [];
    for (let index = bucket.length - 1; index >= 0; index -= 1) {
      const row = bucket[index];
      if (!row) continue;
      size += row.line.length + 1;
      next.unshift(row);
      if (size >= CHUNK_OVERLAP_CHARS) break;
    }
    bucket = next;
    character_count = size;
  };

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] || "";
    const row_size = line.length + 1;
    if (bucket.length > 0 && character_count + row_size > CHUNK_MAX_CHARS) {
      flush();
      carry_overlap();
    }
    bucket.push({ line, line_number: index + 1 });
    character_count += row_size;
  }
  flush();
  return chunks;
}
