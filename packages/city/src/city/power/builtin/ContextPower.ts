/**
 * Context Power：事实查询、公开应用发现与受限编程入口，共用宿主挂载的公开对象契约。
 *
 * 关键点（中文）
 * - 模型侧工具名是 `context`；动作 id 由组名拼成，与拆分前完全一致：
 *   `env.get`、`sandbox.*`、`workspaces.*`、`usage.*`。
 * - 四组查询事实，裸 help 只读接口；execute 先审批完整脚本，再逐次检查公开对象权限。
 * - 只读事实不进入 `system()`：这些答案按需查询即可，常驻 system 会挤占缓存友好的前缀。
 */

import type { CityActionGroup } from "@/city/power/builtin/CityActionGroup.js";
import { CityGroupPower } from "@/city/power/builtin/CityGroupPower.js";
import type { CityGroupPowerOptions } from "@/city/power/builtin/CityGroupPower.js";
import { EnvGroup } from "@/city/power/builtin/groups/EnvGroup.js";
import { SandboxGroup } from "@/city/power/builtin/groups/SandboxGroup.js";
import { UsageGroup } from "@/city/power/builtin/groups/UsageGroup.js";
import { WorkspacesGroup } from "@/city/power/builtin/groups/WorkspacesGroup.js";

import { create_execute_action } from "./runtime/ExecuteAction.js";
import { create_help_action } from "./runtime/HelpAction.js";
import type { RuntimeService } from "./runtime/RuntimeService.js";

/** Context Power：读取事实并在可信 Session 中执行应用代码。 */
export class ContextPower extends CityGroupPower {
  readonly name = "context";
  readonly title = "Context";
  readonly description =
    "Runtime identity, Workspace, sandbox facts and token usage; execute JavaScript/TypeScript "
    + "against the public downcity application SDK. Discover mounted objects with help first.";

  constructor(options: CityGroupPowerOptions, private readonly runtime: RuntimeService) {
    super({
      groups: create_context_action_groups(),
      options,
    });
    this.actions.help = create_help_action(runtime);
    this.actions.execute = create_execute_action(runtime);
  }

  /** 明确局部作用域、发现入口和非事务性效果；身份从可信调用绑定。 */
  override system(): string {
    return `${super.system()}\nContext execute runs JS/TS with top-level await and return. Preloaded: downcity, state, console. Discover live exports with context.help first (read-only, no script approval or engine). Scripts may also call await downcity.help() with the same query, symbol and cursor arguments. Each cell has local variables; only state persists in this Session while its engine lives. No Node globals, imports, raw filesystem or network. Each exact script requires user approval before any code runs, including scripts that only call downcity.help(). Public objects are bound to this execution; host-side caller and target checks remain active. Calls inside an approved script do not ask for approval again. A cell is not a transaction: inspect calls/receipts after partial failure; never replay unknown effects automatically. Secret writes are unavailable. Timeouts/cancellation reclaim state; check runtime_generation and state_reset.`;
  }

  /** Power 卸载先关闭调用门禁，再释放所属 Worker。 */
  async dispose(): Promise<void> { await this.runtime.dispose(); }
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
