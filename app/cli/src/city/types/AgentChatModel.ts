/**
 * Agent Chat 模型选择视图类型。
 *
 * 该类型只保留 TUI 展示和提交模型切换所需的最小目录字段。
 */

import type { RemoteAgentSession } from "@downcity/agent";

/** Chat TUI 可选择的单个模型。 */
export interface AgentChatModelChoice {
  /** 提交给远程 Session 的稳定模型 ID。 */
  model_id: string;
  /** 模型目录中的可读名称；为空时回退到模型 ID。 */
  name: string;
  /** 模型支持的输入输出模态列表。 */
  modalities: string[];
}

/** 模型选择面板的构造输入。 */
export interface AgentChatModelPickerOptions {
  /** 当前用户可调用的完整模型候选列表。 */
  choices: AgentChatModelChoice[];
  /** 当前 Session 的模型可读名称。 */
  current_model_label?: string;
  /** 用户确认模型后的回调。 */
  on_select: (model_id: string) => void;
  /** 用户取消选择后的回调。 */
  on_cancel: () => void;
}

/** Chat 模型命令控制器的构造依赖。 */
export interface AgentChatModelControllerOptions {
  /** 读取当前 TUI 激活的远程 Session。 */
  get_session: () => RemoteAgentSession | null;
  /** 读取 Header 当前投影的模型名称。 */
  get_current_model_label: () => string | undefined;
  /** 模型命令产生状态提示时的回调。 */
  on_status: (message: string) => void;
  /** 模型命令失败时的回调。 */
  on_error: (message: string) => void;
  /** 选择器提交或取消时关闭命令面板。 */
  on_close: () => void;
}
