/**
 * 搜索工具输入 schema。
 *
 * 关键点（中文）
 * - schema 只描述模型可调用协议，路径校验与搜索逻辑由运行时负责。
 * - 参数名统一采用 snake_case，与其他 Shell tools 保持一致。
 */

import { z } from "zod";

/** grep 工具输入 schema。 */
export const grep_tool_input_schema = z.object({
  query: z.string().min(1).describe("Literal text or ripgrep regular expression to search for."),
  path: z
    .string()
    .min(1)
    .optional()
    .default(".")
    .describe("Project-relative or absolute file/directory path. Defaults to the project root."),
  glob: z
    .array(z.string().min(1))
    .max(20)
    .optional()
    .describe("Optional ripgrep glob patterns used to include or exclude candidate files."),
  case_sensitive: z
    .boolean()
    .optional()
    .default(false)
    .describe("Whether matching is case-sensitive. Defaults to false."),
  literal: z
    .boolean()
    .optional()
    .default(true)
    .describe("Treat query as literal text. Set false to use ripgrep regular expressions."),
  max_results: z
    .number()
    .int()
    .min(1)
    .max(2000)
    .optional()
    .default(200)
    .describe("Maximum matches to return. Defaults to 200 and cannot exceed 2000."),
});

/** find 工具输入 schema。 */
export const find_tool_input_schema = z.object({
  pattern: z.string().min(1).describe("POSIX glob pattern used to discover files."),
  path: z
    .string()
    .min(1)
    .optional()
    .default(".")
    .describe("Project-relative or absolute directory to search. Defaults to the project root."),
  max_results: z
    .number()
    .int()
    .min(1)
    .max(2000)
    .optional()
    .default(200)
    .describe("Maximum files to return. Defaults to 200 and cannot exceed 2000."),
});
