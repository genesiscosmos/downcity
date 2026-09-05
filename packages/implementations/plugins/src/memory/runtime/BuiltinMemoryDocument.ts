/**
 * Builtin Memory 的文档协议与纯值归一化。
 *
 * 关键点（中文）
 * - 本模块只负责 memory_id、citation、frontmatter 与领域记录之间的确定性转换。
 * - 本模块不持有 Storage，也不参与 Provider 初始化、访问授权或记忆行为编排。
 * - Markdown 是 Builtin Provider 的内部持久化协议，不向底层 Storage Adapter 泄露领域规则。
 */

import type {
  BuiltinMemoryDigestHandlerOutput,
  BuiltinMemoryMetadata,
  BuiltinMemoryReviseHandlerOutput,
} from "@/memory/types/BuiltinMemoryProvider.js";
import type {
  MemoryRecord,
  MemorySourceReference,
  MemoryType,
} from "@/memory/types/Memory.js";
import type { MemoryAccessContext } from "@/memory/types/MemoryAccess.js";
import type { MemoryStorageEntry } from "@/memory/types/MemoryStorage.js";
import {
  resolve_readable_memory_address,
  type MemorySubjectAddress,
} from "@/memory/runtime/MemoryAddress.js";

/** 限制数值到给定闭区间。 */
export function clamp_number(value: number, minimum: number, maximum: number): number {
  if (!Number.isFinite(value)) return minimum;
  return Math.max(minimum, Math.min(maximum, value));
}

/** 生成用于文件实现内部组织的稳定 slug。 */
export function slugify(value: string): string {
  const text = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return text || "inbox";
}

/** 规范化 Subject 内部的相对 memory_id。 */
export function normalize_relative_memory_id(input: string): string {
  const memory_id = String(input || "")
    .replace(/\\/g, "/")
    .replace(/^\/+/, "")
    .replace(/\.md$/i, "")
    .trim();
  if (!memory_id) throw new Error("memory_id is required");
  const segments = memory_id.split("/");
  if (segments.some((segment) => !/^[a-z0-9][a-z0-9_-]*$/u.test(segment))) {
    throw new Error(`Invalid memory_id: ${input}`);
  }
  if (segments[0] !== "wiki" && segments[0] !== "evidence") {
    throw new Error(`Unsupported Builtin memory_id: ${input}`);
  }
  return segments.join("/");
}

/** 规范化包含 owner/subject 前缀的完整公开 memory_id。 */
export function normalize_memory_id(input: string): string {
  const memory_id = String(input || "")
    .replace(/\\/g, "/")
    .replace(/^memory:\/\/builtin\//, "")
    .replace(/^\/+/, "")
    .replace(/\.md$/i, "")
    .trim();
  if (!memory_id) throw new Error("memory_id is required");
  const segments = memory_id.split("/");
  if (segments.some((segment) => !/^[A-Za-z0-9][A-Za-z0-9_-]*$/u.test(segment))) {
    throw new Error(`Invalid memory_id: ${input}`);
  }
  const relative_start = segments.findIndex((segment) => segment === "wiki" || segment === "evidence");
  if (relative_start < 2) throw new Error(`Unsupported Builtin memory_id: ${input}`);
  normalize_relative_memory_id(segments.slice(relative_start).join("/"));
  return segments.join("/");
}

/** 在 Subject 地址下创建完整 memory_id。 */
export function create_subject_memory_id(
  address: MemorySubjectAddress,
  relative_memory_id: string,
): string {
  return `${address.prefix}/${normalize_relative_memory_id(relative_memory_id)}`;
}

/** 把完整公开 memory_id 映射为 Storage Router key。 */
export function memory_id_to_key(memory_id: string): string {
  return `${normalize_memory_id(memory_id)}.md`;
}

/** 把 Storage Adapter 内部 key 映射为公开 memory_id。 */
export function key_to_memory_id(key: string): string {
  return normalize_memory_id(String(key || "").replace(/\.md$/i, ""));
}

/** 创建 Provider 逻辑 citation。 */
export function create_citation(
  memory_id: string,
  start_line?: number,
  end_line?: number,
): string {
  const base = `memory://builtin/${normalize_memory_id(memory_id)}`;
  if (!start_line) return base;
  return end_line && end_line !== start_line
    ? `${base}#L${start_line}-L${end_line}`
    : `${base}#L${start_line}`;
}

/** 去除 Markdown frontmatter，并保留内容行语义。 */
export function strip_frontmatter(content: string): string {
  const normalized = String(content || "").replace(/\r\n/g, "\n");
  if (!normalized.startsWith("---\n")) return normalized.trim();
  const end_index = normalized.indexOf("\n---\n", 4);
  return end_index < 0 ? normalized.trim() : normalized.slice(end_index + 5).trim();
}

/** 从简化 frontmatter 中读取单个 JSON 字段。 */
function read_frontmatter_json(content: string, key: string): unknown {
  const normalized = String(content || "").replace(/\r\n/g, "\n");
  if (!normalized.startsWith("---\n")) return undefined;
  const end_index = normalized.indexOf("\n---\n", 4);
  if (end_index < 0) return undefined;
  const prefix = `${key}:`;
  const line = normalized.slice(4, end_index)
    .split("\n")
    .find((item) => item.startsWith(prefix));
  if (!line) return undefined;
  const raw_value = line.slice(prefix.length).trim();
  try {
    return JSON.parse(raw_value);
  } catch {
    return raw_value;
  }
}

/** 从 Provider Markdown 读取稳定元数据。 */
export function parse_metadata(
  content: string,
  fallback_type: MemoryType,
): BuiltinMemoryMetadata {
  const raw_type = read_frontmatter_json(content, "memory_type");
  const allowed_types = new Set<MemoryType>([
    "fact",
    "preference",
    "decision",
    "episode",
    "procedure",
    "document",
  ]);
  const memory_type = typeof raw_type === "string" && allowed_types.has(raw_type as MemoryType)
    ? raw_type as MemoryType
    : fallback_type;
  const raw_observed_at = read_frontmatter_json(content, "observed_at");
  const raw_source_refs = read_frontmatter_json(content, "source_refs");
  const source_refs = Array.isArray(raw_source_refs)
    ? raw_source_refs.flatMap((value) => {
        if (!value || typeof value !== "object" || Array.isArray(value)) return [];
        const record = value as Record<string, unknown>;
        const source_id = String(record.source_id || "").trim();
        const source_type = String(record.source_type || "").trim();
        if (!source_id || !source_type) return [];
        const label = String(record.label || "").trim();
        return [{
          source_id,
          source_type,
          ...(label ? { label } : {}),
        } satisfies MemorySourceReference];
      })
    : [];
  const title = read_frontmatter_json(content, "title");
  return {
    ...(typeof title === "string" && title.trim() ? { title: title.trim() } : {}),
    memory_type,
    observed_at: typeof raw_observed_at === "string" && raw_observed_at.trim()
      ? raw_observed_at.trim()
      : new Date(0).toISOString(),
    source_refs,
  };
}

/** 生成 Builtin Provider 使用的 Markdown 记录。 */
export function create_markdown_record(input: {
  title: string;
  content: string;
  memory_type: MemoryType;
  source_refs?: MemorySourceReference[];
  observed_at?: string;
  tags?: string[];
}): string {
  const tags = input.tags?.map((tag) => String(tag || "").trim()).filter(Boolean) ?? [];
  return [
    "---",
    `title: ${JSON.stringify(input.title)}`,
    `memory_type: ${JSON.stringify(input.memory_type)}`,
    `observed_at: ${JSON.stringify(input.observed_at || new Date().toISOString())}`,
    `source_refs: ${JSON.stringify(input.source_refs || [])}`,
    `tags: ${JSON.stringify(tags)}`,
    "---",
    "",
    String(input.content || "").trim(),
    "",
  ].join("\n");
}

/** 把 Storage 条目转换为领域记录。 */
export function storage_entry_to_record(
  entry: MemoryStorageEntry,
  access: MemoryAccessContext,
): MemoryRecord {
  const memory_id = key_to_memory_id(entry.key);
  const address = resolve_readable_memory_address(access, memory_id);
  const is_evidence = memory_id.includes("/evidence/");
  const metadata = parse_metadata(entry.content, is_evidence ? "episode" : "document");
  return {
    memory_id,
    memory_type: metadata.memory_type,
    owner: address.owner,
    subject: address.subject,
    content: strip_frontmatter(entry.content),
    observed_at: metadata.observed_at,
    source_refs: metadata.source_refs,
    citation: create_citation(memory_id),
    ...(metadata.title ? { metadata: { title: metadata.title } } : {}),
  };
}

/** 读取 handler 的 digest 输出。 */
export function normalize_digest_output(
  output: BuiltinMemoryDigestHandlerOutput | string,
): BuiltinMemoryDigestHandlerOutput {
  return typeof output === "string"
    ? {
        projections: [{
          memory_id: "wiki/session-digests",
          title: "Session Digests",
          content: output,
          tags: ["memory", "digest"],
        }],
      }
    : output;
}

/** 读取 handler 的 revise 输出。 */
export function normalize_revise_output(
  output: BuiltinMemoryReviseHandlerOutput | string,
  fallback_memory_id: string,
): BuiltinMemoryReviseHandlerOutput {
  return typeof output === "string"
    ? { memory_id: fallback_memory_id, content: output }
    : output;
}
