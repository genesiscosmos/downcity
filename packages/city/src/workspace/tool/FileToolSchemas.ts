/**
 * 文件工具输入 schema。
 *
 * 关键点（中文）
 * - schema 只描述模型可调用协议，不混入路径与文件系统逻辑。
 * - 参数名统一采用 snake_case，与现有 Shell tools 保持一致。
 */

import { z } from "zod";

/** 文本范围使用严格判别联合；模型 schema 与运行时校验共享互斥语义。 */
const read_range_schema = z.discriminatedUnion("type", [
  z.strictObject({
    type: z.literal("lines"),
    offset: z.number().int().nonnegative().optional().describe("Zero-based line offset; default 0."),
    limit: z.number().int().min(1).max(2000).optional().describe("Maximum lines; default 500, maximum 2000."),
    expected_version: z.string().min(1).optional().describe("Copy file_version from an earlier read; never use a file path or invent a version. Omit for the first read."),
  }),
  z.strictObject({
    type: z.literal("bytes"),
    offset: z.number().int().nonnegative().describe("Raw byte position. Copy next_byte_offset from an earlier read."),
    expected_version: z.string().min(1).optional().describe("Copy file_version from the read being continued. Never use a file path or invent a version."),
  }),
]);

/** 图片、PDF 和首次默认读取仅需 file_path；range 只表达可选文本范围。 */
export const read_file_tool_input_schema = z.strictObject({
  file_path: z.string().min(1).describe("Project file path or the exact path of an attachment owned by this Session. Other external paths are rejected."),
  range: read_range_schema.optional().describe("Optional text range. Omit for images, PDFs, or the default first text read. Choose either lines or bytes, never combine them."),
});

/** write 工具输入 schema。 */
export const write_file_tool_input_schema = z.object({
  file_path: z
    .string()
    .min(1)
    .describe("Project-relative or absolute file path. A sandbox-internal path such as /workspace/a.ts is mapped back to the project root. Paths outside the project root are rejected."),
  content: z.string().describe("Complete UTF-8 text content to write. Emit file_path first. Keep calls bounded; prefer section edits for existing documents and separate files for large SVG illustrations."),
  overwrite: z
    .boolean()
    .optional()
    .default(false)
    .describe("Whether an existing file may be atomically replaced. Defaults to false."),
});

/** 单项 edit 输入 schema。 */
export const file_edit_operation_schema = z.object({
  old_text: z
    .string()
    .min(1)
    .max(10000)
    .describe("Exact text that must occur exactly once in the original file."),
  new_text: z
    .string()
    .max(50000)
    .describe("Replacement text for the unique old_text match."),
});

/** edit 工具输入 schema。 */
export const edit_file_tool_input_schema = z.object({
  file_path: z
    .string()
    .min(1)
    .describe("Project-relative or absolute file path. A sandbox-internal path such as /workspace/a.ts is mapped back to the project root. Paths outside the project root are rejected."),
  edits: z
    .array(file_edit_operation_schema)
    .min(1)
    .max(10)
    .describe("One to ten non-overlapping exact replacements applied atomically. Must be a JSON array of objects, not a JSON-encoded string. Correct validation errors in this input instead of switching to a full-file rewrite."),
  expected_sha256: z
    .string()
    .regex(/^[a-fA-F0-9]{64}$/)
    .optional()
    .describe("Optional SHA-256 returned by read. The edit is rejected if the file changed."),
});
