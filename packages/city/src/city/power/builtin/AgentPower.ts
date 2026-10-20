/**
 * Agent Power：当前 City 内其它 Agent 的具名 power。
 *
 * 关键点（中文）
 * - 模型侧工具名是 `agent`；动作 id 由组名拼成，与拆分前完全一致：`agent.list`、`agent.create`、`agent.delegate`。
 * - 返回 City 下全部 Agent，不做 Workspace 过滤：协作认知边界是 City，不是 Workspace。
 * - list 负责发现，create 创建持久 Agent，delegate 提交跨 Agent 任务；session 仅管理调用方自己的会话。
 */

import type { CityCreateAgent } from "@/city/types/CityCreateAgent.js";
import { CityGroupPower } from "@/city/power/builtin/CityGroupPower.js";
import type { CityGroupPowerOptions } from "@/city/power/builtin/CityGroupPower.js";
import { AgentGroup } from "@/city/power/builtin/groups/AgentGroup.js";
import { create_agent_delegate_action } from "@/city/power/builtin/groups/AgentDelegate.js";

/** Agent Power：发现当前 City 中可见的其它 Agent。 */
export class AgentPower extends CityGroupPower {
  readonly name = "agent";
  readonly title = "Agent";
  readonly description =
    "Discover agents, create persistent agents, and delegate self-contained work to another agent. Delegation results return automatically. Session Power manages only the current agent's own sessions.";

  constructor(options: CityGroupPowerOptions, create_agent?: CityCreateAgent) {
    super({
      groups: [new AgentGroup(create_agent)],
      options,
    });
    this.actions["agent.delegate"] = create_agent_delegate_action(options);
  }
}
