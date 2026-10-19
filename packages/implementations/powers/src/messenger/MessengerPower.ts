/** MessengerPower：Desktop Channel 工作区与可靠消息运行时的 City 级所有者。 */

import { Power } from "@downcity/city/power";
import { SESSION_HOOK_POINTS, type SessionTurnCommittedHookValue } from "@downcity/type";
import type {
  PowerActions,
  PowerHooks,
  PowerContext,
  StepSnapshot,
  PowerLifecycleContext,
} from "@downcity/city/power";
import { read_messenger_accounts_config } from "./accounts/MessengerAccountConfig.js";
import { FeishuAppRegistrationService } from "./accounts/FeishuAppRegistration.js";
import { register_messenger_account_host_actions } from "./host/MessengerAccountHostActions.js";
import { MessengerRuntime } from "./runtime/MessengerRuntime.js";
import { buildMessengerPowerSystem } from "./runtime/MessengerPowerSystem.js";
import { create_messenger_agent_actions } from "./runtime/MessengerAgentActions.js";

/** Messenger Power 的唯一 City 级实现。 */
export class MessengerPower extends Power {
  /** Power 稳定 ID。 */
  readonly name = "messenger";

  /** Power 用户可见标题。 */
  readonly title = "Messengers";

  /** Power 用户可见说明。 */
  readonly description = "Connects Bot Accounts and external conversations to Agent Sessions.";

  /** Agent Actions 将在可靠 Outbox 路由完成后只保留严格的会话内能力。 */
  readonly actions: PowerActions;

  /** 完成事件统一负责自动回复，不依赖入站等待者是否仍在内存。 */
  readonly hooks: PowerHooks = {
    effect: {
      [SESSION_HOOK_POINTS.turn_committed]: [Object.assign(async ({ context, value }: Parameters<NonNullable<PowerHooks["effect"]>[string][number]>[0]) => {
        if (context.session?.origin.type !== "channel") return;
        this.require_runtime().commit_completion(context.agent.id, value as unknown as SessionTurnCommittedHookValue);
      }, { handler_id: "channel_reply" })],
    },
  };

  /** 当前 Power 唯一的长期 Messenger Runtime。 */
  private runtime?: MessengerRuntime;

  /** 扫码创建飞书应用的注册会话；生命周期与 Power 一致。 */
  private readonly feishu_registration = new FeishuAppRegistrationService();

  /** 创建稳定 Action 定义；执行时解析 initialize 后的唯一 Runtime。 */
  constructor() {
    super();
    this.actions = create_messenger_agent_actions(() => this.require_runtime());
  }

  /** System Provider 只投影静态提示资产，不产生启动副作用。 */
  readonly system = async (
    _context: PowerContext,
    execution_context?: StepSnapshot,
  ): Promise<string> => buildMessengerPowerSystem(execution_context);

  /** 从 City 唯一配置恢复全部 enabled Bot Account 和可靠 Worker。 */
  async initialize(context: PowerLifecycleContext): Promise<void> {
    const config = read_messenger_accounts_config(context.config.get());
    const runtime = new MessengerRuntime(context);
    this.runtime = runtime;
    register_messenger_account_host_actions(context, () => this.require_runtime(), this.feishu_registration);
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
  private require_runtime(): MessengerRuntime {
    const runtime = this.runtime;
    if (!runtime) throw new Error("Messenger Power is not initialized");
    return runtime;
  }
}
