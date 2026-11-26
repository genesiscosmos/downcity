/** 所有 Memory 写入口共用的严格内容 schema；超预算明确拒绝，禁止静默截断。 */
import { z } from "zod";
import { contains_memory_credentials } from "./MemorySensitiveText.js";
import type { MemoryContent, MemoryRecord } from "../types/MemoryRecord.js";

/** Unicode 码点预算，不能使用 UTF-16 长度冒充字符数。 */
function bounded_text(maximum: number) {
  return z.string().refine((value) => value.trim().length > 0, "Text must not be empty")
    .refine((value) => Array.from(value).length <= maximum, `Text exceeds ${maximum} Unicode code points`)
    .refine((value) => !contains_memory_credentials(value), "MEMORY_SENSITIVE_TEXT: explicit credential patterns cannot be persisted");
}

/** 规范记录 ID：scope 地址、wiki 命名空间和单层 opaque 标识；不做输入归一化。 */
export const memory_id_schema = z.string().regex(
  /^(?:agent\/[a-z0-9_]+|(?:user|workspace)\/(?:[a-f0-9]{2})+)\/wiki\/[A-Za-z0-9_-]+$/u,
  "Invalid canonical Memory ID",
);

export const memory_scope_schema = z.enum(["user", "agent", "workspace"]);
export const memory_kind_schema = z.enum(["agreement", "knowledge"]);
export const memory_content_schema = bounded_text(12_000);
export const memory_title_schema = bounded_text(160);
export const memory_source_selector_schema = z.object({
  message_id: z.string().min(1), part_id: z.string().min(1).optional(), excerpt: bounded_text(12_000).optional(),
}).strict();
const source_refs = z.array(memory_source_selector_schema).max(100).optional();
const request_id = z.string().min(1).max(512).optional();
const scope_fields = { scope: memory_scope_schema, source_refs, request_id };

export const memory_remember_schema = z.discriminatedUnion("kind", [
  z.object({ ...scope_fields, kind: z.literal("agreement"), content: memory_content_schema }).strict(),
  z.object({ ...scope_fields, kind: z.literal("knowledge"), title: memory_title_schema, content: memory_content_schema }).strict(),
]).superRefine((value, context) => {
  if (value.scope === "workspace" && value.kind === "agreement") {
    context.addIssue({ code: "custom", message: "Workspace supports Knowledge only", path: ["scope"] });
  }
});
export const memory_update_schema = z.object({
  memory_id: memory_id_schema, expected_version: z.string().min(1),
  content: memory_content_schema, title: memory_title_schema.optional(), source_refs, request_id,
}).strict();
export const memory_forget_schema = z.object({
  memory_id: memory_id_schema, expected_version: z.string().min(1),
  state: z.enum(["invalidated", "deleted"]).optional(), source_refs, request_id,
}).strict();
export const memory_read_schema = z.object({
  memory_id: memory_id_schema, from_line: z.number().int().positive().optional(),
  line_count: z.number().int().positive().optional(),
}).strict();
export const memory_list_schema = z.object({
  scope: memory_scope_schema.optional(), kind: memory_kind_schema.optional(),
  limit: z.number().int().min(1).max(500).optional(), offset: z.number().int().nonnegative().optional(),
}).strict();
export const memory_search_schema = memory_list_schema.omit({ limit: true, offset: true }).extend({
  query: z.string().trim().min(1), max_results: z.number().int().min(1).max(50).optional(),
  min_score: z.number().min(0).max(1).optional(),
}).strict();
export const memory_digest_schema = z.object({
  scope: memory_scope_schema, kind: memory_kind_schema, session_id: z.string().min(1),
  type: z.enum(["chat", "work"]), max_messages: z.number().int().min(1).max(100).optional(),
}).strict();
export const memory_revise_schema = z.object({
  memory_id: memory_id_schema, expected_version: z.string().min(1), instruction: memory_content_schema,
  evidence: memory_content_schema.optional(), source_refs,
}).strict();
export const memory_optimize_schema = z.object({ scope: memory_scope_schema, kind: memory_kind_schema }).strict();

/** 从已读类型校验完整替换；普通 update 不能改变种类或范围。 */
export function validate_memory_content(kind: MemoryRecord["kind"], content: string, title?: string): MemoryContent {
  memory_content_schema.parse(content);
  if (kind === "agreement") {
    if (title !== undefined) throw new Error("Agreement must not have title");
    return { kind, content };
  }
  memory_title_schema.parse(title);
  return { kind, content, title: title! };
}

/** 列表、活动、资源和搜索统一使用的纯展示投影；不改变正文和注入。 */
export function memory_display_label(record: MemoryContent): string {
  if (record.kind === "knowledge") return record.title;
  const paragraph = record.content.split(/\n\s*\n/u).find((text) => text.trim()) ?? record.content;
  const text = paragraph.replace(/!?(?:\[([^\]]+)\])\([^)]*\)/gu, "$1")
    .replace(/(^|\n)\s*(?:#{1,6}\s+|[-*>]\s+|\d+[.)]\s+)/gu, "$1")
    .replace(/[`*_~]/gu, "").replace(/\s+/gu, " ").trim();
  const segments = Array.from(new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(text), (item) => item.segment);
  return segments.length > 72 ? `${segments.slice(0, 72).join("")}…` : text;
}
