/**
 * Context Power：当前执行环境与运行时事实的具名 power。
 *
 * 关键点（中文）
 * - 模型侧工具名是 `context`；动作 id 由组名拼成，与拆分前完全一致：
 *   `env.get`、`sandbox.*`、`workspaces.*`、`usage.*`。
 * - 四组都只回答「我现在是谁、在哪、被什么边界约束」，不写文件也不改变外部状态。
 * - 只读事实不进入 `system()`：这些答案按需查询即可，常驻 system 会挤占缓存友好的前缀。
 */

import type { CityActionGroup } from "@/city/power/builtin/CityActionGroup.js";
import { CityGroupPower } from "@/city/power/builtin/CityGroupPower.js";
import type { CityGroupPowerOptions } from "@/city/power/builtin/CityGroupPower.js";
import { EnvGroup } from "@/city/power/builtin/groups/EnvGroup.js";
import { SandboxGroup } from "@/city/power/builtin/groups/SandboxGroup.js";
import { UsageGroup } from "@/city/power/builtin/groups/UsageGroup.js";
import { WorkspacesGroup } from "@/city/power/builtin/groups/WorkspacesGroup.js";

/** Context Power：读取当前 Agent、Session、Workspace 与沙箱边界。 */
export class ContextPower extends CityGroupPower {
  readonly name = "context";
  readonly title = "Context";
  readonly description =
    "Read-only runtime facts for the current execution: identity, Workspace, sandbox boundary, "
    + "and token usage.";

  constructor(options: CityGroupPowerOptions) {
    super({
      groups: create_context_action_groups(),
      options,
    });
  }
}

/** 创建 Context Power 的动作组；顺序即模型侧索引顺序。 */
function create_context_action_groups(): CityActionGroup[] {
  return [
    new EnvGroup(),
    new SandboxGroup(),
    new WorkspacesGroup(),
    new UsageGroup(),
  ];
}
