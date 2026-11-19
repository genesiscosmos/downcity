/** canonical 消息内容的通用展示块；领域投影可注入 Power 与附件，SDK 拥有正文顺序与交互反馈。 */
import type { ReactNode } from "react";
import type { SessionAgentActionPart, SessionAgentDataPart, SessionAgentErrorPart, SessionAgentFilePart, SessionAgentInputPart, SessionAgentViewPart, SessionAgentReasoningPart, SessionAgentTextPart, SessionAgentToolPart, SessionTurnFileDiffData, SessionUserMessagePart } from "@downcity/type";
import type { DowncityChatPanelProps } from "./chat";
/** 共享同一时间线的活动记录。 */
export type AgentActivityPart = SessionAgentToolPart | SessionAgentActionPart | SessionAgentReasoningPart;
/** 正文协议中已解析的附件信息；本地路径由宿主按权限解释。 */
export interface AgentMessageAttachment {
  /** 附件路径或资源位置。 */ path: string;
  /** 媒体类型。 */ type: "document" | "photo" | "video" | "audio" | "voice";
  /** 可选说明。 */ caption?: string;
}
/** 按 canonical 顺序呈现的单层内容块。 */
export type AgentMessageBlock =
  | { /** 运行时输入。 */ type: "input"; /** canonical 输入快照。 */ part: SessionAgentInputPart }
  | { /** Power 内容。 */ type: "view"; /** canonical 内容或受信任宿主预览。 */ part: SessionAgentViewPart; /** 是否只为生成中的预览。 */ preview?: boolean }
  | { /** 正文。 */ type: "text"; /** canonical 正文。 */ part: SessionAgentTextPart }
  | { /** 连续活动。 */ type: "activity"; /** 原位有序的工具、操作与推理。 */ parts: AgentActivityPart[] }
  | { /** 文件。 */ type: "file"; /** canonical 文件。 */ part: SessionAgentFilePart }
  | { /** 正文附件。 */ type: "attachment"; /** 来源正文。 */ part: SessionAgentTextPart; /** 标签在原文的字符位置。 */ offset: number; /** 完整标签。 */ source: string; /** 经过协议解析的附件。 */ file: AgentMessageAttachment }
  | { /** 文件差异。 */ type: "file-diff"; /** 来源数据。 */ part: SessionAgentDataPart; /** 已验证的差异。 */ data: SessionTurnFileDiffData }
  | { /** 错误。 */ type: "error"; /** canonical 错误。 */ part: SessionAgentErrorPart };
/** Agent 正文展示能力。 */
export interface AgentMessageContentProps {
  /** 消息稳定标识。 */ message_id: string;
  /** canonical 顺序的展示块。 */ blocks: readonly AgentMessageBlock[];
  /** 当前消息是否正在生成。 */ streaming: boolean;
  /** 正文后的操作栏。 */ actions?: ReactNode;
  /** 替换业务块展示；undefined 使用 SDK 默认行为，null 显式隐藏。 */ render_block?(block: Exclude<AgentMessageBlock, { type: "text" | "error" | "file" }>): ReactNode;
  /** 当前可恢复的错误 Part；来自 Session 当前运行态。 */ retry_error_part_id?: string;
  /** 是否显示当前消息的 canonical 错误。 */ show_errors?: boolean;
  /** 重试当前错误的宿主提交能力。 */ retry_message?(message_id: string): Promise<void>;
  /** 运行态和队列是否允许重试。 */ can_retry?: boolean;
  /** 重试按钮文案。 */ retry_label?: string;
  /** 文件缺少名称时的文案。 */ file_label?: string;
  /** 默认活动展示使用的交互响应能力。 */ on_respond_interaction?: DowncityChatPanelProps["on_respond_interaction"];
  /** 非标准交互的业务呈现。 */ render_interaction?: DowncityChatPanelProps["render_interaction"];
}
/** 用户正文展示能力；不持有 Session 重写事务。 */
export interface UserMessageContentProps {
  /** canonical 消息标识。 */ message_id: string;
  /** 原位有序的正文、引用与附件。 */ parts: readonly SessionUserMessagePart[];
  /** 宿主文件预览；省略时显示文件链接。 */ render_file?(part: Extract<SessionUserMessagePart, { type: "file" }>): ReactNode;
  /** 宿主引用预览；省略时显示可展开快照。 */ render_reference?(part: Extract<SessionUserMessagePart, { type: "context" }>): ReactNode;
}
