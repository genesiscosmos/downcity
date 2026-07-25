/**
 * 文件工具输入 schema。
 *
 * 关键点（中文）
 * - schema 只描述模型可调用协议，不混入路径与文件系统逻辑。
 * - 参数名统一采用 snake_case，与现有 Shell tools 保持一致。
 */

import { z } from "zod";

/** read 工具输入 schema。 */
export const read_file_tool_input_schema = z.object({
  file_path: z
    .string()
    .min(1)
    .describe("Project-relative or absolute file path. Paths outside the project root are rejected."),
  offset: z
    .number()
    .int()
    .min(0)
    .optional()
    .default(0)
    .describe("Zero-based line offset. Defaults to 0."),
  limit: z
    .number()
    .int()
    .min(1)
    .max(2000)
    .optional()
    .default(500)
    .describe("Maximum lines to return. Defaults to 500 and cannot exceed 2000."),
});

/** write 工具输入 schema。 */
export const write_file_tool_input_schema = z.object({
  file_path: z
    .string()
    .min(1)
    .describe("Project-relative or absolute file path. Paths outside the project root are rejected."),
  content: z.string().describe("Complete UTF-8 text content to write."),
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
    .describe("Project-relative or absolute file path. Paths outside the project root are rejected."),
  edits: z
    .array(file_edit_operation_schema)
    .min(1)
    .max(10)
    .describe("One to ten non-overlapping exact replacements applied atomically."),
  expected_sha256: z
    .string()
    .regex(/^[a-fA-F0-9]{64}$/)
    .optional()
    .describe("Optional SHA-256 returned by read. The edit is rejected if the file changed."),
});
