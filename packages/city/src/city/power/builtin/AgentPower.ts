/**
 * Agent Power：当前 City 内其它 Agent 的具名 power。
 *
 * 关键点（中文）
 * - 模型侧工具名是 `agent`；动作 id 由组名拼成，与拆分前完全一致：`agent.list`、`agent.create`。
 * - 返回 City 下全部 Agent，不做 Workspace 过滤：协作认知边界是 City，不是 Workspace。
 * - list 负责发现，create 借用宿主的持久化创建能力；工作交互通过 session 工具完成。
 */

import type { CityCreateAgent } from "@/city/types/CityCreateAgent.js";
import { CityGroupPower } from "@/city/power/builtin/CityGroupPower.js";
import type { CityGroupPowerOptions } from "@/city/power/builtin/CityGroupPower.js";
import { AgentGroup } from "@/city/power/builtin/groups/AgentGroup.js";

/** Agent Power：发现当前 City 中可见的其它 Agent。 */
export class AgentPower extends CityGroupPower {
  readonly name = "agent";
  readonly title = "Agent";
  readonly description =
    "Discover agents and create persistent agents in this City. Use the session tool to start and continue work with an agent.";

  constructor(options: CityGroupPowerOptions, create_agent?: CityCreateAgent) {
    super({
      groups: [new AgentGroup(create_agent)],
      options,
    });
  }
}
