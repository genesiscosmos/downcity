/** ContextPower 的只读发现入口：复用公开对象帮助契约与运行服务，不执行脚本或请求写审批。 */
import { z } from "zod";
import type { PowerAction, PowerJsonObject } from "../../../../power/index.js";
import { application_help_schema } from "../../../../application/ApplicationHelp.js";
import type { RuntimeService } from "./RuntimeService.js";

/** 工具参数与脚本帮助同源；仅返回当前宿主发布的接口描述。 */
export function create_help_action(runtime: RuntimeService): PowerAction {
  return {
    description: "Discover mounted public downcity objects without running code or requesting execution approval. Omit arguments for the index; use query or symbol and cursor for details.",
    returns: "Live sdk_revision, mounted objects, up to 12 public symbols with generated input/output types, and next_cursor.",
    access: "read",
    input_schema: { zod: application_help_schema, json_schema: z.toJSONSchema(application_help_schema) as PowerJsonObject },
    async execute({ input, context }) {
      return { success: true, data: await runtime.help(input, context) as never };
    },
  };
}
