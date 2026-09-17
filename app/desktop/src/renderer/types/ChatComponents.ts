/** 聊天组件契约：编辑器只依赖输入能力，队列与领域操作由业务组件组合。 */
import type { ReactNode } from "react";
import type { JSONContent } from "@tiptap/core";
import type { DesktopAgentSummary, DesktopChatFileInput, DesktopWorkspaceFile } from "@common/types/DesktopApi";
import type { ChatSubmitMode, QueuedChatMessage } from "@/types/DesktopView";
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
  /** 尚未处理的聚焦请求序号；大于 0 且与已处理序号不同时，编辑器挂载后获得键盘焦点。 */
  focus_request?: number;
  /** 空输入时的占位提示。 */
  placeholder: string;
  /** 当前对话是否正在执行，用于提交和停止交互。 */
  busy: boolean;
  /** 当前是否已有待发送队列，用于准确呈现常规提交的去向。 */
  has_pending_queue?: boolean;
  /** 当前场景是否支持创建暂停队列。 */
  can_queue?: boolean;
  /** 是否启用浏览器拼写检查。 */
  spellcheck_enabled: boolean;
  /** 保存当前输入文档。 */
  update_draft(input: JSONContent): void;
  /** 按常规策略提交，或在 steer 模式下绕过队列立即提交。 */
  send_message(input: JSONContent, mode?: ChatSubmitMode): Promise<void>;
  /** 停止执行；草稿场景不提供此能力。 */
  stop_session?(): Promise<void>;
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

/** 历史用户消息富文本编辑器的交互契约。 */
export interface UserMessageRewriteEditorProps {
  /** 从 canonical User Message 恢复出的初始文档。 */
  initial_document: JSONContent;
  /** 是否正在向 Main 提交 rewrite 事务。 */
  submitting: boolean;
  /** 当前提交失败的用户可见原因。 */
  error: string;
  /** 放弃本次编辑。 */
  cancel(): void;
  /** 提交编辑器当前完整文档。 */
  submit(document: JSONContent): void;
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
  actions: Pick<import("./DesktopView").DesktopActions, "update_draft" | "send_message" | "set_session_model" | "set_session_reasoning_effort" | "set_session_approval_mode" | "stop_session" | "remove_queued_message" | "send_queued_message" | "update_queued_message" | "toggle_queued_message_paused" | "set_queue_paused" | "move_queued_message">;
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
