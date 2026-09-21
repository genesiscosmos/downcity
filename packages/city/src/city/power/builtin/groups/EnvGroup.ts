/**
 * city power `env` 动作组。
 *
 * 关键点（中文）
 * - 只回答「我现在是谁、在哪、用什么模型、现在几点」这类自身环境问题。
 * - 全部字段来自当前执行上下文，不读取文件系统、不访问网络。
 */

import { format_date_in_timezone } from "@downcity/type";
import type { CityPowerContext } from "@/city/types/CityPowerContext.js";
import type { CityToolEnv } from "@/city/types/CityPowerData.js";
import { CityAction } from "@/city/power/builtin/CityAction.js";
import { CityActionGroup } from "@/city/power/builtin/CityActionGroup.js";

/** 读取当前 Agent 与执行环境的身份事实。 */
class GetEnvAction extends CityAction {
  readonly action = "get";
  readonly description = "Read the current agent, session, workspace, model and time.";
  readonly returns =
    "agent_id, agent_name, session_id, turn_id, workspace_id, workspace_name, "
    + "workspace_path, model_id, timezone, now, current_date";

  protected async run(
    _args: Record<string, never>,
    context: CityPowerContext,
  ): Promise<CityToolEnv> {
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

/** `env` 动作组。 */
export class EnvGroup extends CityActionGroup {
  readonly group = "env";
  readonly summary = "Identity and runtime facts for the current agent, session and workspace.";
  protected readonly actions = [new GetEnvAction()];
}
