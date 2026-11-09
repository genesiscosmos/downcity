/**
 * 通用 lookup 的模型工具适配器。可信身份保存在私有 WeakSet 中，业务 JSON 的 view
 * 字段和工具名称都不能伪造豁免；结果页已经满足完整信封预算，不再递归生成引用。
 */
import type { BoundAgentTool } from "@/types/tool/BoundAgentTool.js";
import type { ResultLookup, ResultLookupInput } from "./ResultReader.js";

const lookup_tools = new WeakSet<BoundAgentTool>();

/** 构造每 Step 独立的只读模型工具。 */
export function create_lookup_tool(read: ResultLookup): BoundAgentTool {
  const tool: BoundAgentTool = {
    description: "Read an immutable saved tool result without executing it again. Omit cursor to start at the beginning; otherwise pass next_cursor unchanged. Default 100 lines, maximum 200; the complete page is byte-bounded and long lines may be split. References grant no additional session permissions.",
    input_schema: { type: "object", properties: {
      result_ref: { type: "string", description: "Stable result_ref returned by a tool result." },
      cursor: { type: "string", description: "Opaque next_cursor from the same result." },
      limit: { type: "integer", minimum: 1, maximum: 200, description: "Maximum lines, default 100." },
    }, required: ["result_ref"], additionalProperties: false },
    execute: async (input) => await read(input as ResultLookupInput),
  };
  lookup_tools.add(tool);
  return tool;
}

/** 只允许框架创建的实例跳过普通首次披露。 */
export function is_lookup_tool(tool: BoundAgentTool | undefined): boolean {
  return tool !== undefined && lookup_tools.has(tool);
}
