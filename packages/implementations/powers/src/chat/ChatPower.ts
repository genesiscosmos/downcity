/** ChatPower：Desktop Channel 工作区与可靠消息运行时的 City 级所有者。 */

import { Power } from "@downcity/city/power";
import type {
  PowerActions,
  PowerContext,
  StepSnapshot,
  PowerLifecycleContext,
} from "@downcity/city/power";
import { read_chat_accounts_config } from "./accounts/ChatAccountConfig.js";
import { FeishuAppRegistrationService } from "./accounts/FeishuAppRegistration.js";
import { register_chat_account_host_actions } from "./host/ChatAccountHostActions.js";
import { ChatRuntime } from "./runtime/ChatRuntime.js";
import { buildChatPowerSystem } from "./runtime/ChatPowerSystem.js";
import { create_chat_agent_actions } from "./runtime/ChatAgentActions.js";

/** Chat Power 的唯一 City 级实现。 */
export class ChatPower extends Power {
  /** Power 稳定 ID。 */
  readonly name = "chat";

  /** Power 用户可见标题。 */
  readonly title = "Channels";

  /** Power 用户可见说明。 */
  readonly description = "Connects Bot Accounts and external conversations to Agent Sessions.";

  /** Agent Actions 将在可靠 Outbox 路由完成后只保留严格的会话内能力。 */
  readonly actions: PowerActions;

  /** 当前 Power 唯一的长期 Chat Runtime。 */
  private runtime?: ChatRuntime;

  /** 扫码创建飞书应用的注册会话；生命周期与 Power 一致。 */
  private readonly feishu_registration = new FeishuAppRegistrationService();

  /** 创建稳定 Action 定义；执行时解析 initialize 后的唯一 Runtime。 */
  constructor() {
    super();
    this.actions = create_chat_agent_actions(() => this.require_runtime());
  }

  /** System Provider 只投影静态提示资产，不产生启动副作用。 */
  readonly system = async (
    _context: PowerContext,
    execution_context?: StepSnapshot,
  ): Promise<string> => buildChatPowerSystem(execution_context);

  /** 从 City 唯一配置恢复全部 enabled Bot Account 和可靠 Worker。 */
  async initialize(context: PowerLifecycleContext): Promise<void> {
    const config = read_chat_accounts_config(context.config.get());
    const runtime = new ChatRuntime(context);
    this.runtime = runtime;
    register_chat_account_host_actions(context, () => this.require_runtime(), this.feishu_registration);
    await runtime.initialize(config.accounts);
  }

  /** 释放 Worker、在途 Turn、Connector 和 Store。 */
  async dispose(): Promise<void> {
    const runtime = this.runtime;
    this.runtime = undefined;
    this.feishu_registration.dispose();
    if (runtime) await runtime.dispose();
  }

  /** 返回 initialize 后可用的唯一 Runtime。 */
  private require_runtime(): ChatRuntime {
    const runtime = this.runtime;
    if (!runtime) throw new Error("Chat Power is not initialized");
    return runtime;
  }
}
