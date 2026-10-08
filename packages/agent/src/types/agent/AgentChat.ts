/**
 * Agent 对话面（chat）的公开协议。
 *
 * 职责说明（中文）
 * - chat 是 Agent 自己那段 Session 的对话面向，不是独立对象。
 * - 它只暴露「和 Agent 说话」需要的能力，方法语义与 Session 同名能力逐一对应：
 *   `send` ↔ `prompt`、`messages` ↔ `messages`、`subscribe` ↔ `subscribe`。
 * - 需要 Session 的其余能力（fork、system、snapshot）时，用 `agent.sessions.main()`
 *   取到 Session 本身，不在这里转发。
 *
 * 关键点（中文）
 * - `send` 不接收 Workspace：对话当前在哪个目录是会话状态，不是每次输入参数。
 * - 换目录用 `set_workspace()`，语义与 `set({ model })` 同级。
 */

import type {
  ListSessionMessagesInput,
  RespondSessionInteractionInput,
  SessionInteractionRequest,
  SessionInteractionResult,
  SessionMessagePage,
  SessionMutationSubscriber,
  SessionMutationUnsubscribe,
  WorkspaceRuntime,
} from "@downcity/type";
import type { AgentSessionPromptInput } from "@/types/sdk/AgentSessionPrompt.js";
import type { AgentSessionStopResult } from "@/types/sdk/AgentSessionStop.js";
import type { AgentSessionTurnHandle } from "@/types/sdk/AgentSessionTurn.js";
import type { AgentSessionStatus } from "@/types/agent/SessionTypes.js";

/**
 * 打开 Agent 主对话时的可选参数。
 */
export interface AgentChatInput {
  /**
   * 建立主对话时使用的当前目录。
   *
   * 说明（中文）
   * - 省略时使用 `new Agent({ workspace })` 声明的默认目录。
   * - 两者都没有时该对话没有项目上下文：没有文件工具与 Shell，但纯模型对话仍可用。
   * - 主对话已经存在时该参数被忽略；换目录必须走 `set_workspace()`，否则会静默漂移。
   */
  workspace?: WorkspaceRuntime;
}

/**
 * Agent 对话面。
 */
export interface AgentChat {
  /** 当前对话的 Session 稳定标识。 */
  readonly session_id: string;

  /** 提交一次用户输入，并返回本次 Turn 的等待句柄；与 `session.prompt()` 同形。 */
  send(input: AgentSessionPromptInput): Promise<AgentSessionTurnHandle>;

  /** 读取历史 Message 分页；与 `session.messages()` 同形。 */
  messages(input?: ListSessionMessagesInput): Promise<SessionMessagePage>;

  /** 订阅后续变化；与 `session.subscribe()` 同形。 */
  subscribe(
    subscriber: SessionMutationSubscriber,
  ): SessionMutationUnsubscribe;

  /** 停止当前 Turn，并取消尚未被吸收的排队输入；与 `session.stop()` 同形。 */
  stop(): Promise<AgentSessionStopResult>;

  /** 列出正在等待用户响应的 Interaction；与 `session.interactions()` 同形。 */
  interactions(): Promise<SessionInteractionRequest[]>;

  /** 提交一个 Interaction 的用户响应；与 `session.respond()` 同形。 */
  respond(input: RespondSessionInteractionInput): Promise<SessionInteractionResult>;

  /** 读取当前运行与安全状态；与 `session.status()` 同形。 */
  status(): Promise<AgentSessionStatus>;

  /** 返回当前目录；没有项目上下文时为空。 */
  workspace(): WorkspaceRuntime | undefined;

  /** 就地切换当前目录；传空表示脱离项目上下文。 */
  set_workspace(workspace?: WorkspaceRuntime): Promise<void>;
}
