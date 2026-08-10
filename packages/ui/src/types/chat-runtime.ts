/** Chat runtime 的可移植状态和宿主回调协议。 */
import type { DowncityChatApprovalMode, DowncityChatMessage, DowncityChatModelOption, DowncityChatStatus, DowncityChatSubmitInput } from "./chat";

/** Runtime 初始化和宿主能力。 */
export interface DowncityChatRuntimeOptions {
  /** 初始 Session JSONL。 */ initial_jsonl?: string;
  /** 初始规范化消息。 */ initial_messages?: DowncityChatMessage[];
  /** 默认模型列表。 */ model_options?: DowncityChatModelOption[];
  /** 当前模型。 */ model_id?: string;
  /** 当前 approval 模式。 */ approval_mode?: DowncityChatApprovalMode;
  /** 将用户输入提交到宿主 Session。 */ submit_message?: (input: DowncityChatSubmitInput, mode: "send" | "queue") => void | Promise<void>;
  /** 请求宿主停止当前 turn。 */ stop_generation?: () => void | Promise<void>;
  /** 将 approval/question 响应写回 Session。 */ respond_interaction?: (interaction_id: string, response: unknown) => void | Promise<void>;
}

/** Runtime 的只读快照。 */
export interface DowncityChatRuntimeSnapshot {
  /** 当前消息。 */ messages: DowncityChatMessage[];
  /** 当前运行状态。 */ status: DowncityChatStatus;
  /** 模型列表。 */ model_options: DowncityChatModelOption[];
  /** 当前模型。 */ model_id: string;
  /** approval 模式。 */ approval_mode: DowncityChatApprovalMode;
}

/** Runtime 状态订阅回调。 */
export type DowncityChatRuntimeListener = (snapshot: DowncityChatRuntimeSnapshot) => void;
