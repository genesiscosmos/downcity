/** ContextPower 的唯一编程动作；schema 只描述代码与预算，不含领域方法目录。 */
import { z } from "zod";
import type { PowerAction } from "../../../../power/index.js";
import type { RuntimeService } from "./RuntimeService.js";

const execute_schema = z.object({
  code: z.string().min(1).refine(value => Buffer.byteLength(value, "utf8") <= 128 * 1024, "Source exceeds 128 KiB"),
  language: z.enum(["javascript", "typescript"]).default("typescript"),
  timeout_ms: z.number().int().min(1).max(60_000).default(15_000),
  max_output_tokens: z.number().int().min(256).max(8000).default(2000),
}).strict();

/** 预算由 RuntimeService 管理，审批等待不得计入外层固定 timeout。 */
export function create_execute_action(runtime: RuntimeService): PowerAction {
  return {
    description: "Run JavaScript/TypeScript against the discoverable public downcity SDK. Discover objects with context.help first; downcity.help() is also available inside scripts. Each exact script requires user approval before execution; host object permissions still apply. A cell is not a transaction.",
    returns: "Execution ID, runtime generation, status, JSON value, bounded logs and SDK call receipts; state_reset and result_ref describe recovery and truncation.",
    access: "write",
    approval: "always",
    input_schema: { zod: execute_schema, json_schema: { type: "object", properties: { code: { type: "string" }, language: { type: "string", enum: ["javascript", "typescript"] }, timeout_ms: { type: "integer", minimum: 1, maximum: 60000 }, max_output_tokens: { type: "integer", minimum: 256, maximum: 8000 } }, required: ["code"], additionalProperties: false } },
    async execute({ input, context }) {
      try {
        const result = await runtime.execute(execute_schema.parse(input), context);
        return { success: result.status === "completed", data: result as never, ...(result.error ? { error: result.error.message } : {}) };
      } catch (error) { return { success: false, error: String(error) }; }
    },
  };
}
