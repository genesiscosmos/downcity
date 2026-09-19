/**
 * 工具输入校验模块。
 *
 * 关键点（中文）
 * - 模型返回的工具参数必须在派发前按工具自己的 schema 校验，避免类型错误变成裸运行时异常。
 * - 只有 Zod schema 参与校验；原始 JSON Schema 工具（city、各 power）由各自下游运行时校验。
 * - 校验失败不执行工具，直接形成结构化失败，语义与模型侧输入解析失败保持一致。
 */

import { z } from "zod";
import type { ModelJsonValue, RuntimeTool } from "@downcity/type";

/** 单次工具输入校验的结果。 */
export type ToolInputValidationResult =
  | {
      /** 校验通过后的规范化输入，zod 默认值已生效。 */
      input: ModelJsonValue;
    }
  | {
      /** 面向模型的输入错误说明，可直接作为工具失败原因。 */
      error: string;
    };

/** 读取工具声明中的 Zod schema；原始 JSON Schema 或无 schema 时返回 undefined。 */
function read_zod_schema(value: unknown): z.ZodType | undefined {
  if (!value || typeof value !== "object") return undefined;
  const candidate = value as { safeParse?: unknown };
  return typeof candidate.safeParse === "function" ? (value as z.ZodType) : undefined;
}

/** 把 Zod 校验错误压成单行、可定位字段的说明。 */
function format_zod_error(error: z.ZodError): string {
  return error.issues
    .map((issue) => {
      const field_path = issue.path.join(".");
      return field_path ? `${field_path}: ${issue.message}` : issue.message;
    })
    .join("; ");
}

/** 按工具自己的 schema 校验一次模型输入。 */
export function validate_tool_input(input: {
  /** 目标工具定义。 */
  tool: RuntimeTool;
  /** 面向模型的工具名，用于错误说明。 */
  tool_name: string;
  /** 模型返回的原始输入。 */
  input: ModelJsonValue;
}): ToolInputValidationResult {
  const schema = read_zod_schema(input.tool.input_schema);
  if (!schema) return { input: input.input };
  const parsed = schema.safeParse(input.input);
  if (parsed.success) return { input: parsed.data as ModelJsonValue };
  return {
    error: `Invalid input for tool "${input.tool_name}": ${format_zod_error(parsed.error)}`,
  };
}
