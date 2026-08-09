/**
 * Downcity Chat UI 的公共协议类型。
 *
 * 这些类型只描述展示层需要的数据，不绑定 Agent、Session、网络或存储实现。
 */

import type * as React from "react";

/** Chat 面板的运行状态。 */
export type DowncityChatStatus =
  | "ready"
  | "submitted"
  | "streaming"
  | "error";

/** Chat 消息的角色。 */
export type DowncityChatMessageRole = "user" | "assistant" | "system" | "error";

/** Chat 消息中的附件。 */
export interface DowncityChatAttachment {
  /** 附件唯一标识。 */
  id: string;
  /** 附件显示名称。 */
  name: string;
  /** 可选的附件类型。 */
  type?: string;
  /** 可选的附件预览地址。 */
  url?: string;
}

/** Chat 消息。 */
export interface DowncityChatMessage {
  /** 消息唯一标识。 */
  id: string;
  /** 消息角色。 */
  role: DowncityChatMessageRole;
  /** 消息正文；Markdown 渲染由宿主通过 render_message 控制。 */
  content: string;
  /** 可选的消息创建时间。 */
  created_at?: Date | number | string;
  /** 可选的消息附件。 */
  attachments?: DowncityChatAttachment[];
  /** 消息是否仍在流式生成。 */
  is_streaming?: boolean;
  /** 可选的工具活动展示内容。 */
  activity?: React.ReactNode;
}

/** Chat 会话摘要。 */
export interface DowncityChatThread {
  /** 会话唯一标识。 */
  id: string;
  /** 会话标题。 */
  title: string;
  /** 可选的最近更新时间。 */
  updated_at?: Date | number | string;
  /** 会话是否包含未读内容。 */
  unread?: boolean;
  /** 会话是否已归档。 */
  archived?: boolean;
}

/** Chat 输入提交值。 */
export interface DowncityChatSubmitInput {
  /** 用户输入正文。 */
  text: string;
  /** 用户选择的附件。 */
  attachments: DowncityChatAttachment[];
}

/** Chat 消息渲染器参数。 */
export interface DowncityChatMessageRenderProps {
  /** 当前待渲染消息。 */
  message: DowncityChatMessage;
}

/** Chat 面板属性。 */
export interface DowncityChatPanelProps
  extends Omit<React.ComponentPropsWithoutRef<"div">, "children" | "title"> {
  /** 当前会话。 */
  thread?: DowncityChatThread | null;
  /** 可供历史列表展示的会话。 */
  threads?: DowncityChatThread[];
  /** 当前会话消息。 */
  messages?: DowncityChatMessage[];
  /** Agent 当前运行状态。 */
  status?: DowncityChatStatus;
  /** 是否展示历史会话列表。 */
  history_open?: boolean;
  /** 是否正在加载历史会话。 */
  history_loading?: boolean;
  /** 是否还有更早的历史会话。 */
  has_more_threads?: boolean;
  /** 是否处于登录状态。 */
  is_logged_in?: boolean;
  /** 顶部标题，未提供时使用当前会话标题。 */
  title?: React.ReactNode;
  /** 空状态标题。 */
  empty_title?: React.ReactNode;
  /** 空状态说明。 */
  empty_description?: React.ReactNode;
  /** 输入框占位文案。 */
  input_placeholder?: string;
  /** 发送消息。 */
  on_submit?: (input: DowncityChatSubmitInput) => void | Promise<void>;
  /** 停止当前生成。 */
  on_stop?: () => void | Promise<void>;
  /** 创建新会话。 */
  on_create_thread?: () => void | Promise<void>;
  /** 选择会话。 */
  on_select_thread?: (thread_id: string) => void | Promise<void>;
  /** 归档会话。 */
  on_archive_thread?: (thread_id: string) => void | Promise<void>;
  /** 加载更早的会话。 */
  on_load_more_threads?: () => void | Promise<void>;
  /** 自定义消息渲染器。 */
  render_message?: (props: DowncityChatMessageRenderProps) => React.ReactNode;
  /** 自定义顶部操作区。 */
  render_header_actions?: () => React.ReactNode;
  /** 自定义底部内容。 */
  render_footer?: () => React.ReactNode;
}
