/**
 * city tool `env` namespace。
 *
 * 关键点（中文）
 * - 只回答「我现在是谁、在哪、用什么模型、现在几点」这类自身环境问题。
 * - 全部字段来自当前执行上下文，不读取文件系统、不访问网络。
 */

import type {
  CityToolActionCall,
  CityToolContext,
  CityToolNamespaceProvider,
} from "@/city/types/CityTool.js";
import type { CityToolEnv } from "@/city/types/CityToolNamespaces.js";
import { assert_known_args } from "@/city/tool/CityToolArgs.js";
import { unexpected_city_tool_action } from "@/city/tool/CityToolErrors.js";
import { format_local_date } from "@/city/tool/CityToolTime.js";

/** 构造当前环境的返回数据。 */
function read_env(context: CityToolContext): CityToolEnv {
  return {
    agent_id: context.agent_id,
    agent_name: context.agent_name,
    session_id: context.session_id,
    turn_id: context.turn_id,
    workspace_id: context.workspace_id,
    workspace_name: context.workspace_name,
    workspace_path: context.workspace_path,
    model_id: context.model_id,
    timezone: context.timezone,
    now: context.now.toISOString(),
    current_date: format_local_date({ date: context.now, timezone: context.timezone }),
  };
}

/** 创建 `env` namespace provider。 */
export function create_env_namespace(): CityToolNamespaceProvider {
  return {
    namespace: "env",
    summary: "Identity and runtime facts for the current agent, session and workspace.",
    actions: [
      {
        action: "get",
        summary: "Read the current agent, session, workspace, model and time.",
        args: [],
        returns:
          "agent_id, agent_name, session_id, turn_id, workspace_id, workspace_name, "
          + "workspace_path, model_id, timezone, now, current_date",
        capability: "read",
        sensitivity: "public",
      },
    ],
    handle: async (call: CityToolActionCall) => {
      switch (call.action) {
        case "get":
          assert_known_args({ args: call.args, allowed: [], action: call.action });
          return read_env(call.context);
        default:
          throw unexpected_city_tool_action({ namespace: "env", action: call.action });
      }
    },
  };
}
