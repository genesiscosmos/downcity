/** 聊天组件契约：编辑器只依赖输入能力，队列与领域操作由业务组件组合。 */
import type { ReactNode } from "react";
import type { JSONContent } from "@tiptap/core";
import type { DesktopAgentSummary, DesktopChatFileInput, DesktopWorkspaceFile } from "@common/types/DesktopApi";
import type { QueuedChatMessage } from "@/types/DesktopView";
import type { ChatSlashCommand } from "@/types/ChatComposer";

/** 当前工作区为编辑器提供的附件读取能力。 */
export interface ComposerAttachments {
  /** 列出当前工作区中可引用的文件。 */
  list_files(): Promise<DesktopWorkspaceFile[]>;
  /** 读取用户选中的文件并返回可提交的附件内容。 */
  read_file(relative_path: string): Promise<DesktopChatFileInput>;
}

/** 富文本编辑器需要的文档、交互与可组合界面。 */
export interface RichTextEditorProps {
  /** 输入所属的稳定标识，切换时保存原输入并恢复目标草稿。 */
  editor_key: string;
  /** 当前结构化草稿，外部变更会同步到编辑器。 */
  draft_content: JSONContent;
  /** 空输入时的占位提示。 */
  placeholder: string;
  /** 当前对话是否正在执行，用于提交和停止交互。 */
  busy: boolean;
  /** 是否启用浏览器拼写检查。 */
  spellcheck_enabled: boolean;
  /** Enter 是否直接发送，关闭时使用系统修饰键加 Enter。 */
  send_message_on_enter: boolean;
  /** 保存当前输入文档。 */
  update_draft(input: JSONContent): void;
  /** 提交输入，失败时拒绝 Promise，由调用方恢复草稿。 */
  send_message(input: JSONContent): Promise<void>;
  /** 加入下一轮队列；不支持排队的场景不提供此能力。 */
  enqueue_message?(input: JSONContent): Promise<void>;
  /** 停止执行；草稿场景不提供此能力。 */
  stop_session?(): Promise<void>;
  /** 执行当前会话的压缩命令；无历史的场景不提供。 */
  compact_session?(): Promise<void>;
  /** 工作区附件能力；不支持附件的场景不提供。 */
  attachments?: ComposerAttachments;
  /** 可通过 @ 引用的成员，未提供时关闭成员选择。 */
  members?: DesktopAgentSummary[];
  /** 所属聊天场景提供的额外斜杠命令。 */
  commands?: ChatSlashCommand[];
  /** 输入工具栏，由场景组合模型、审批等控制项。 */
  toolbar?: ReactNode;
  /** 编辑器上方的队列区域，由队列组件独立订阅状态。 */
  queue?: ReactNode;
}

/** 待发送队列的展示与操作契约。 */
export interface MessageQueueProps {
  /** 当前会话按发送顺序排列的待发送消息。 */
  queued_messages: QueuedChatMessage[];
  /** 整个队列是否暂停自动发送。 */
  queue_paused: boolean;
  /** 删除尚未发送的消息。 */
  remove_queued_message(message_id: string): void;
  /** 立即发送指定消息。 */
  send_queued_message(message_id: string): Promise<void>;
  /** 更新队列中的纯文本消息。 */
  update_queued_message(message_id: string, text: string): void;
  /** 切换单条消息的暂停状态。 */
  toggle_queued_message_paused(message_id: string): void;
  /** 更新整个队列的暂停状态。 */
  set_queue_paused(paused: boolean): void;
  /** 向上或向下调整未发送消息的顺序。 */
  move_queued_message(message_id: string, direction: "up" | "down"): void;
}

/** 单聊输入区域可以访问的领域能力。 */
export interface AgentComposerProps {
  /** 当前草稿或正式会话的导航标识。 */
  selection: Extract<import("./DesktopView").NavigationTarget, { kind: "draft" | "session" }>;
  /** 输入区域按切片订阅的目录、草稿、配置与用户偏好。 */
  stores: Pick<import("./DesktopView").DesktopController["stores"], "catalog" | "composer" | "chat_stream" | "settings">;
  /** 输入配置与消息提交能力。 */
  actions: Pick<import("./DesktopView").DesktopActions, "update_draft" | "send_message" | "set_session_model" | "set_session_reasoning_effort" | "set_session_approval_mode" | "compact_session" | "stop_session" | "remove_queued_message" | "send_queued_message" | "update_queued_message" | "toggle_queued_message_paused" | "set_queue_paused" | "move_queued_message">;
}

/** 群聊输入区域的精确领域依赖。 */
export interface GroupComposerProps {
  /** 当前群聊草稿或正式会话。 */
  selection: Extract<import("./DesktopView").NavigationTarget, { kind: "group_draft" | "group_session" }>;
  /** 群聊输入需要订阅的目录、输入、执行状态与偏好。 */
  stores: AgentComposerProps["stores"];
  /** 群聊输入、发送、停止与切换会话操作。 */
  actions: Pick<import("./DesktopView").DesktopActions, "update_group_draft" | "send_group_message" | "stop_group" | "open_group">;
}
