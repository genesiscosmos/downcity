/**
 * Context Power：事实查询与受限应用编程入口，唯一 execute 由专属运行服务提供。
 *
 * 关键点（中文）
 * - 模型侧工具名是 `context`；动作 id 由组名拼成，与拆分前完全一致：
 *   `env.get`、`sandbox.*`、`workspaces.*`、`usage.*`。
 * - 四组只查询事实；裸 execute 的实际效果由公开应用 SDK 逐次授权。
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
import type { RuntimeService } from "./runtime/RuntimeService.js";

/** Context Power：读取事实并在可信 Session 中执行应用代码。 */
export class ContextPower extends CityGroupPower {
  readonly name = "context";
  readonly title = "Context";
  readonly description =
    "Runtime identity, Workspace, sandbox facts and token usage; execute JavaScript/TypeScript "
    + "against the discoverable public downcity application SDK.";

  constructor(options: CityGroupPowerOptions, private readonly runtime: RuntimeService) {
    super({
      groups: create_context_action_groups(),
      options,
    });
    this.actions.execute = create_execute_action(runtime);
  }

  /** 明确局部作用域、发现入口和非事务性效果；身份从可信调用绑定。 */
  override system(): string {
    return `${super.system()}\nContext execute runs JS/TS with top-level await and return. Preloaded: downcity, state, console. Discover live exports with await downcity.help(). Each cell has local variables; only state persists in this Session while its engine lives. No Node globals, imports, raw filesystem or network. SDK calls are individually authorized and writes request host approval. A cell is not a transaction: inspect calls/receipts after partial failure; never replay unknown effects automatically. Secret writes are unavailable. Timeouts/cancellation reclaim state; check runtime_generation and state_reset.`;
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
