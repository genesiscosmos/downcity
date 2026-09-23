/**
 * Agent Power：当前 City 内其它 Agent 的具名 power。
 *
 * 关键点（中文）
 * - 模型侧工具名是 `agent`；动作 id 由组名拼成，与拆分前完全一致：`agent.list`、`agent.get`。
 * - 返回 City 下全部 Agent，不做 Workspace 过滤：协作认知边界是 City，不是 Workspace。
 * - 当前只提供列表与详情；委派、通知等写操作尚未进入本 power。
 */

import type { CityActionGroup } from "@/city/power/builtin/CityActionGroup.js";
import { CityGroupPower } from "@/city/power/builtin/CityGroupPower.js";
import type { CityGroupPowerOptions } from "@/city/power/builtin/CityGroupPower.js";
import { AgentGroup } from "@/city/power/builtin/groups/AgentGroup.js";

/** Agent Power：发现当前 City 中可见的其它 Agent。 */
export class AgentPower extends CityGroupPower {
  readonly name = "agent";
  readonly title = "Agent";
  readonly description =
    "Agents registered in this City, including the current one.";

  constructor(options: CityGroupPowerOptions) {
    super({
      groups: create_agent_action_groups(),
      options,
    });
  }
}

/** 创建 Agent Power 的动作组；顺序即模型侧索引顺序。 */
function create_agent_action_groups(): CityActionGroup[] {
  return [new AgentGroup()];
}
