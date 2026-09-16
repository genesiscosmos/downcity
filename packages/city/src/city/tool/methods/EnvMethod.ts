/**
 * city tool `env` method。
 *
 * 关键点（中文）
 * - 只回答「我现在是谁、在哪、用什么模型、现在几点」这类自身环境问题。
 * - 全部字段来自当前执行上下文，不读取文件系统、不访问网络。
 */

import type { CityToolContext } from "@/city/types/CityTool.js";
import type { CityToolEnv } from "@/city/types/CityToolMethods.js";
import { format_date_in_timezone } from "@downcity/agent";
import { CityAction, type CityToolArgs } from "@/city/tool/CityAction.js";
import { CityMethod } from "@/city/tool/CityMethod.js";

/** 读取当前 Agent 与执行环境的身份事实。 */
class GetEnvAction extends CityAction {
  readonly action = "get";
  readonly summary = "Read the current agent, session, workspace, model and time.";
  readonly returns =
    "agent_id, agent_name, session_id, turn_id, workspace_id, workspace_name, "
    + "workspace_path, model_id, timezone, now, current_date";

  protected async run(_args: CityToolArgs, context: CityToolContext): Promise<CityToolEnv> {
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
      current_date: format_date_in_timezone(context.now, context.timezone),
    };
  }
}

/** `env` method。 */
export class EnvMethod extends CityMethod {
  readonly method = "env";
  readonly summary = "Identity and runtime facts for the current agent, session and workspace.";
  protected readonly actions = [new GetEnvAction()];
}
