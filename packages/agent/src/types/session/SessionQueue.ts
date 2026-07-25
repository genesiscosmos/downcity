/**
 * Session 输入队列类型。
 *
 * 队列只保存明确的输入事实，不保存可执行闭包。SessionTurn 是这些输入的唯一解释者。
 */

import type { AgentSessionConfigSnapshot } from "@/types/agent/SessionTypes.js";
import type { AgentPluginExecutionRuntime } from "@/types/plugin/PluginRuntime.js";
import type { AgentSessionPromptInput } from "@/types/sdk/AgentSessionPrompt.js";
import type { AgentSessionTurnHandle } from "@/types/sdk/AgentSessionTurn.js";

/** Session 模型配置在 Step 检查点生效的命令。 */
export interface SessionModelQueueCommand {
  /** 命令种类固定为 Session 模型更新。 */
  type: "session_model";
  /** 当前命令的稳定唯一标识。 */
  command_id: string;
  /** 等待提交为 effective state 的完整 Session 配置。 */
  config: AgentSessionConfigSnapshot;
  /** 配置生效后需要写入的可选 Action 标识。 */
  action_id?: string;
  /** 配置生效后需要写入的可选 Action 标题。 */
  action_title?: string;
}

/** Workspace env 在 Session Step 检查点生效的命令。 */
export interface SessionEnvQueueCommand {
  /** 命令种类固定为 Workspace env 更新。 */
  type: "workspace_env";
  /** 当前命令的稳定唯一标识。 */
  command_id: string;
  /** 下一 Step 使用的完整环境变量快照。 */
  env: Record<string, string>;
}

/** Agent Plugin 视图在 Session Step 检查点生效的命令。 */
export interface SessionPluginsQueueCommand {
  /** 命令种类固定为 Agent Plugin 更新。 */
  type: "agent_plugins";
  /** 当前命令的稳定唯一标识。 */
  command_id: string;
  /** 当前 Plugin 修改的用户可读标题。 */
  title: string;
  /** 下一 Step 使用的 Plugin 执行视图。 */
  plugins: AgentPluginExecutionRuntime;
}

/** 显式持久化历史压缩命令。 */
export interface SessionCompactQueueCommand {
  /** 命令种类固定为 compact。 */
  type: "compact";
  /** 当前命令的稳定唯一标识。 */
  command_id: string;
}

/** Session FIFO 中允许出现的领域命令。 */
export type SessionQueueCommand =
  | SessionModelQueueCommand
  | SessionEnvQueueCommand
  | SessionPluginsQueueCommand
  | SessionCompactQueueCommand;

/** Agent configured state 广播给既有 Session 的输入。 */
export type AgentSessionCommand = {
    /** 当前修改固定为 env。 */
    type: "env";
    /** 当前命令唯一标识。 */
    command_id: string;
    /** 下一 Session Step 使用的完整 Workspace env。 */
    env: Record<string, string>;
  }
  | {
      /** 当前修改固定为 plugins。 */
      type: "plugins";
      /** 当前命令唯一标识。 */
      command_id: string;
      /** 当前 Plugin 修改的用户可读标题。 */
      title: string;
      /** 下一 Session Step 使用的 Plugin 执行视图。 */
      plugins: AgentPluginExecutionRuntime;
    };

/** Promise 的显式兑现控制器。 */
export interface SessionQueueDeferred<T> {
  /** 调用方等待的 Promise。 */
  promise: Promise<T>;
  /** 成功兑现 Promise。 */
  resolve: (value: T) => void;
}

/** FIFO 中等待创建或并入 Turn 的 Prompt。 */
export interface SessionQueuedPrompt {
  /** 队列项种类固定为 prompt。 */
  type: "prompt";
  /** 当前 Prompt 的结构化输入。 */
  input: AgentSessionPromptInput;
  /** 等待 SessionTurn 返回 Turn Handle 的控制器。 */
  deferred_handle: SessionQueueDeferred<AgentSessionTurnHandle>;
}

/** Session FIFO 中的全部输入类型。 */
export type SessionQueueItem = SessionQueuedPrompt | SessionQueueCommand;
