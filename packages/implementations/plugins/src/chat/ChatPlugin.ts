/** ChatPlugin：Desktop Channel 工作区与可靠消息运行时的 City 级所有者。 */

import { Plugin } from "@downcity/city/plugin";
import type {
  PluginActions,
  PluginContext,
  PluginExecutionContext,
  PluginLifecycleContext,
} from "@downcity/city/plugin";
import { read_chat_accounts_config } from "./accounts/ChatAccountConfig.js";
import { register_chat_account_host_actions } from "./host/ChatAccountHostActions.js";
import { ChatRuntime } from "./runtime/ChatRuntime.js";
import { buildChatPluginSystem } from "./runtime/ChatPluginSystem.js";
import { create_chat_agent_actions } from "./runtime/ChatAgentActions.js";

/** Chat Plugin 的唯一 City 级实现。 */
export class ChatPlugin extends Plugin {
  /** Plugin 稳定 ID。 */
  readonly name = "chat";

  /** Plugin 用户可见标题。 */
  readonly title = "Channels";

  /** Plugin 用户可见说明。 */
  readonly description = "Connects Bot Accounts and external conversations to Agent Sessions.";

  /** Agent Actions 将在可靠 Outbox 路由完成后只保留严格的会话内能力。 */
  readonly actions: PluginActions;

  /** 当前 Plugin 唯一的长期 Chat Runtime。 */
  private runtime?: ChatRuntime;

  /** 创建稳定 Action 定义；执行时解析 initialize 后的唯一 Runtime。 */
  constructor() {
    super();
    this.actions = create_chat_agent_actions(() => this.require_runtime());
  }

  /** System Provider 只投影当前 Chat Session 上下文，不产生启动副作用。 */
  readonly system = async (
    context: PluginContext,
    execution_context?: PluginExecutionContext,
  ): Promise<string> => await buildChatPluginSystem(context, execution_context);

  /** 从 City 唯一配置恢复全部 enabled Bot Account 和可靠 Worker。 */
  async initialize(context: PluginLifecycleContext): Promise<void> {
    const config = read_chat_accounts_config(context.config.get());
    const runtime = new ChatRuntime(context);
    this.runtime = runtime;
    register_chat_account_host_actions(context, () => this.require_runtime());
    await runtime.initialize(config.accounts);
  }

  /** 释放 Worker、在途 Turn、Connector 和 Store。 */
  async dispose(): Promise<void> {
    const runtime = this.runtime;
    this.runtime = undefined;
    if (runtime) await runtime.dispose();
  }

  /** 返回 initialize 后可用的唯一 Runtime。 */
  private require_runtime(): ChatRuntime {
    const runtime = this.runtime;
    if (!runtime) throw new Error("Chat Plugin is not initialized");
    return runtime;
  }
}
