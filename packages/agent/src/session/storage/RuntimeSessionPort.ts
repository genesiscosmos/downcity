/**
 * SDK Session 宿主运行时端口构造器。
 *
 * 关键点（中文）
 * - 把 SDK 本地 Session 适配成宿主运行时依赖的 `SessionPort`。
 * - SDK 公开面只保留 `prompt()` / `subscribe()`；runtime/service 若要 one-shot 等待结果，也统一委托给 `prompt()`。
 */

import type { SessionPort } from "@/types/session/SessionPort.js";
import type { AgentSessionPromptInput } from "@/types/sdk/AgentSessionPrompt.js";
import type { AgentSessionStopResult } from "@/types/sdk/AgentSessionStop.js";
import type {
  SessionMutationSubscriber,
  SessionMutationUnsubscribe,
} from "@downcity/type";
import type { AgentSessionTurnHandle } from "@/types/sdk/AgentSessionTurn.js";

/**
 * 构造 SDK SessionPort 的参数。
 */
export interface CreateRuntimeSessionPortParams {
  /**
   * 当前 session_id。
   */
  session_id: string;
  /** 获取当前 Session 优先解析后的运行时模型实例。 */
  get_model: SessionPort["get_model"];
  /** 读取全部 canonical Session Message。 */
  messages: SessionPort["messages"];
  /**
   * 追加一条新的 session prompt。
   */
  prompt: (input: AgentSessionPromptInput) => Promise<AgentSessionTurnHandle>;
  /**
   * 停止当前 turn，并取消尚未被吸收的排队 prompt。
   */
  stop: () => Promise<AgentSessionStopResult>;
  /**
   * 订阅当前 session 的 future 事件。
   */
  subscribe: (
    subscriber: SessionMutationSubscriber,
  ) => SessionMutationUnsubscribe;
  /**
   * 追加 user 消息到底层历史。
   */
  append_user_message: SessionPort["append_user_message"];
  /**
   * 追加 Agent 消息到底层历史。
   */
  append_agent_message: SessionPort["append_agent_message"];
  /**
   * 返回当前 session 是否正在执行。
   */
  is_executing: () => boolean;
  /**
   * 在执行前确保当前 session 已完成初始化与宿主级配置。
   */
  ensure_ready_for_execution: () => Promise<void>;
}

/**
 * 创建供宿主运行时使用的 Session 端口。
 */
export function create_runtime_session_port(
  params: CreateRuntimeSessionPortParams,
): SessionPort {
  return {
    session_id: params.session_id,
    get_model: () => params.get_model(),
    messages: async () => await params.messages(),
    prompt: async (input) => {
      await params.ensure_ready_for_execution();
      return await params.prompt(input);
    },
    stop: async () => {
      await params.ensure_ready_for_execution();
      return await params.stop();
    },
    subscribe: (subscriber) => {
      return params.subscribe(subscriber);
    },
    append_user_message: async (messageParams) => {
      await params.append_user_message(messageParams);
    },
    append_agent_message: async (message_params) => {
      await params.append_agent_message(message_params);
    },
    is_executing: () => params.is_executing(),
  };
}
