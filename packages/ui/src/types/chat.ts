/**
 * Chat UI 的公共展示协议。
 *
 * 该协议刻意贴近 Session SDK 的 canonical message，不包含网络、存储或
 * Electron 能力；宿主负责把自己的 SessionMessage 投影到这里。
 */
import type * as React from "react";

/** Chat 面板运行状态。 */
export type DowncityChatStatus = "ready" | "submitted" | "streaming" | "building-context" | "error";
/** 消息角色。 */
export type DowncityChatMessageRole = "user" | "assistant" | "system" | "error";
/** 消息 part 类型。 */
export type DowncityChatMessagePartType = "text" | "reasoning" | "tool" | "interaction" | "file" | "source" | "operation" | "changed-files" | "data" | "step-start";

/** Chat 消息中的结构化 part。 */
export interface DowncityChatMessagePart {
  /** part 稳定标识。 */ id: string;
  /** part 类型。 */ type: DowncityChatMessagePartType;
  /** 文本内容。 */ text?: string;
  /** part 是否仍在流式生成。 */ state?: string;
  /** 工具调用标识。 */ tool_call_id?: string;
  /** 工具注册名称。 */ tool_name?: string;
  /** 工具显示名称。 */ tool_display_name?: string;
  /** 工具状态。 */ tool_state?: string;
  /** 工具输入。 */ input?: unknown;
  /** 工具尚未完成输入时的原始 JSON 文本。 */ input_text?: string;
  /** 工具输出。 */ output?: unknown;
  /** 工具错误。 */ error?: string;
  /** 交互标识。 */ interaction_id?: string;
  /** 交互关联的工具调用标识。 */ interaction_tool_call_id?: string;
  /** 交互标题。 */ title?: React.ReactNode;
  /** 交互说明。 */ description?: React.ReactNode;
  /** 交互类型。 */ interaction_type?: "approval" | "question" | string;
  /** 交互业务请求 payload。 */ interaction_payload?: unknown;
  /** 交互响应 schema。 */ interaction_response_schema?: unknown;
  /** 交互状态。 */ interaction_status?: string;
  /** 问题集合。 */ questions?: DowncityChatQuestion[];
  /** 文件 URL。 */ url?: string;
  /** 文件 MIME 类型。 */ media_type?: string;
  /** 文件名。 */ filename?: string;
  /** source 标题。 */ source_title?: string;
  /** source 地址。 */ source_url?: string;
  /** operation 状态载荷。 */ operation?: DowncityChatOperation;
  /** changed-files 文件集合。 */ files?: DowncityChatChangedFile[];
  /** changed-files 汇总。 */ summary?: DowncityChatChangedFileSummary;
  /** data 类型。 */ data_type?: string;
  /** data 内容。 */ data?: unknown;
}

/** Question 选项。 */
export interface DowncityChatQuestionOption { /** 选项值。 */ value: string; /** 选项显示文案。 */ label: string; }
/** 一个交互问题。 */
export interface DowncityChatQuestion {
  /** 问题标识。 */ id: string;
  /** 提示文案。 */ prompt: string;
  /** 响应类型。 */ response_type: "text" | "single_select" | "multi_select";
  /** 可选项。 */ options?: DowncityChatQuestionOption[];
}
/** 工具操作展示载荷。 */
export interface DowncityChatOperation { /** 操作状态。 */ status: string; /** 操作名称。 */ name: string; /** 操作标题。 */ label?: string; /** 操作进度。 */ progress?: number; /** 失败原因。 */ error?: string; }
/** 变更文件统计。 */
export interface DowncityChatChangedFile { /** 文件路径。 */ path: string; /** 新增行数。 */ additions: number; /** 删除行数。 */ deletions: number; /** diff 文本。 */ diff?: string; }
/** 变更文件汇总。 */
export interface DowncityChatChangedFileSummary { /** 文件数量。 */ file_count: number; /** 新增行数。 */ additions: number; /** 删除行数。 */ deletions: number; }
/** 消息附件。 */
export interface DowncityChatAttachment { /** 附件标识。 */ id: string; /** 附件名称。 */ name: string; /** 附件类型。 */ type?: string; /** 预览地址。 */ url?: string; /** 文件大小。 */ size?: number; }
/** Chat 消息。 */
export interface DowncityChatMessage {
  /** 消息标识。 */ id: string;
  /** 消息角色。 */ role: DowncityChatMessageRole;
  /** 纯文本回退内容。 */ content?: string;
  /** 按 canonical 顺序排列的 parts。 */ parts?: DowncityChatMessagePart[];
  /** 创建时间。 */ created_at?: Date | number | string;
  /** 顶层附件。 */ attachments?: DowncityChatAttachment[];
  /** 是否流式。 */ is_streaming?: boolean;
  /** 展示元数据。 */ metadata?: { official_message_id?: string; presentation_status?: string; error?: string; sequence?: number; revision?: number; turn_id?: string; visibility?: string; session_type?: string; };
}
/** 会话摘要。 */
export interface DowncityChatThread { /** 会话标识。 */ id: string; /** 会话标题。 */ title: string; /** 更新时间。 */ updated_at?: Date | number | string; /** 是否未读。 */ unread?: boolean; /** 是否归档。 */ archived?: boolean; }
/** 输入区模型选项。 */
export interface DowncityChatModelOption { /** 模型标识。 */ id: string; /** 模型显示名称。 */ label: string; }
/** 输入区审批模式。 */
export type DowncityChatApprovalMode = "ask" | "always-allow";
/** 输入附件。 */
export interface DowncityChatSubmitAttachment extends DowncityChatAttachment { /** 附件文本内容。 */ text?: string; /** 附件 base64。 */ base64?: string; }
/** 输入提交值。 */
export interface DowncityChatSubmitInput { /** 输入正文。 */ text: string; /** 输入附件。 */ attachments: DowncityChatSubmitAttachment[]; }
/** 自定义消息渲染参数。 */
export interface DowncityChatMessageRenderProps { /** 当前消息。 */ message: DowncityChatMessage; }
/** Chat Panel 属性。 */
export interface DowncityChatPanelProps extends Omit<React.ComponentPropsWithoutRef<"div">, "children" | "title"> {
  /** 可选 Chat runtime；提供后由 runtime 持有消息、状态和提交逻辑。 */
  runtime?: import("../lib/chat-runtime").DowncityChatRuntime;
  /** 当前会话。 */ thread?: DowncityChatThread | null;
  /** 历史会话。 */ threads?: DowncityChatThread[];
  /** 消息列表。 */ messages?: DowncityChatMessage[];
  /** 运行状态。 */ status?: DowncityChatStatus;
  /** 初始历史打开状态。 */ history_open?: boolean;
  /** 历史加载状态。 */ history_loading?: boolean;
  /** 是否有更多历史。 */ has_more_threads?: boolean;
  /** 是否登录。 */ is_logged_in?: boolean;
  /** 标题。 */ title?: React.ReactNode;
  /** 空状态标题。 */ empty_title?: React.ReactNode;
  /** 空状态描述。 */ empty_description?: React.ReactNode;
  /** 输入占位符。 */ input_placeholder?: string;
  /** 可选模型列表。 */ model_options?: DowncityChatModelOption[];
  /** 当前模型标识。 */ model_id?: string;
  /** 模型切换回调。 */ on_model_change?: (model_id: string) => void | Promise<void>;
  /** 当前审批模式。 */ approval_mode?: DowncityChatApprovalMode;
  /** 审批模式切换回调。 */ on_approval_mode_change?: (mode: DowncityChatApprovalMode) => void | Promise<void>;
  /** 提交消息。 */ on_submit?: (input: DowncityChatSubmitInput, mode?: "send" | "queue") => void | Promise<void>;
  /** 停止生成。 */ on_stop?: () => void | Promise<void>;
  /** 响应当前 Session Interaction。 */ on_respond_interaction?: (interaction_id: string, response: unknown) => void | Promise<void>;
  /** 自定义 Interaction 呈现器；未提供时使用内置呈现。 */ render_interaction?: (props: { part: DowncityChatMessagePart; on_respond_interaction?: DowncityChatPanelProps["on_respond_interaction"] }) => React.ReactNode;
  /** 打开附件选择。 */ on_attach?: () => void;
  /** 新建会话。 */ on_create_thread?: () => void | Promise<void>;
  /** 选择会话。 */ on_select_thread?: (thread_id: string) => void | Promise<void>;
  /** 归档会话。 */ on_archive_thread?: (thread_id: string) => void | Promise<void>;
  /** 加载更多会话。 */ on_load_more_threads?: () => void | Promise<void>;
  /** 自定义消息渲染。 */ render_message?: (props: DowncityChatMessageRenderProps) => React.ReactNode;
  /** 顶部自定义操作。 */ render_header_actions?: () => React.ReactNode;
  /** 底部自定义内容。 */ render_footer?: () => React.ReactNode;
}
