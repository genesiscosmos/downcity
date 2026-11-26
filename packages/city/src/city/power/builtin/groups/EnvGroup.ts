/**
 * city power `env` 动作组。
 *
 * 关键点（中文）
 * - 只回答「我现在是谁、在哪、用什么模型、现在几点」这类自身环境问题。
 * - 身份读取统一上下文，时间在查询时生成，不读取文件系统、不访问网络。
 */

import { format_date_in_timezone, resolve_runtime_timezone } from "@downcity/type";
import type { PowerContext } from "@/power/types/PowerContext.js";
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
    context: PowerContext,
  ): Promise<CityToolEnv> {
    const timezone = resolve_runtime_timezone();
    const now = new Date();
    return {
      agent_id: context.agent.id,
      agent_name: context.agent.name,
      session_id: context.session?.id ?? null,
      turn_id: context.turn?.id ?? null,
      workspace_id: context.workspace?.id ?? null,
      workspace_name: context.workspace?.name ?? null,
      workspace_path: context.workspace?.path ?? null,
      model_id: context.agent.model?.id ?? null,
      timezone,
      now: now.toISOString(),
      current_date: format_date_in_timezone(now, timezone),
    };
  }
}

/** `env` 动作组。 */
export class EnvGroup extends CityActionGroup {
  readonly group = "env";
  protected readonly actions = [new GetEnvAction()];
}
