/** 状态面板的数据与动作契约；宿主持有队列调度、来源地址和提交 transport。 */
import type { ReactNode } from "react";
import type { JSONContent } from "@tiptap/core";
import type { RespondSessionInteractionInput, SessionAgentInteraction } from "@downcity/type";
import type { ChatInputHost } from "./chat-input";
import type { ChatControlMessages } from "./chat-controls";

/** 一条待发送消息，不包含调度策略。 */
export interface QueuedChatMessage {
  /** 当前会话内稳定的队列项标识。 */ message_id: string;
  /** 按原子节点顺序保存的编辑文档。 */ input: JSONContent;
  /** 是否正在提交，提交中的项目不能移动或编辑。 */ sending: boolean;
}
/** 队列展示与宿主动作。 */
export interface MessageQueueProps extends ChatControlMessages {
  /** 按发送顺序排列的队列。 */ queued_messages: readonly QueuedChatMessage[];
  /** 是否暂停自动发送。 */ queue_paused: boolean;
  /** 正在输入区编辑的条目标识；存在时锁定队列操作。 */ editing_message_id?: string;
  /** 删除指定队列项。 */ remove_queued_message(message_id: string): void;
  /** 立即发送指定队列项，宿主负责错误处理。 */ send_queued_message(message_id: string): Promise<void>;
  /** 在宿主输入区编辑完整文档。 */ edit_queued_message(message_id: string): void;
  /** 设置整队暂停状态。 */ set_queue_paused(paused: boolean): void;
  /** 将条目放到尚未发送部分的首位。 */ pin_queued_message(message_id: string): void;
  /** 定制附件与引用展示；省略时提供可展开的默认资源摘要。 */ render_resources?(input: JSONContent): ReactNode;
}
/** 待处理交互及其完整来源身份。 */
export interface PendingInteractionItem {
  /** 共享 Session 协议中的交互快照。 */ part: SessionAgentInteraction;
  /** 跨来源稳定唯一的展示 key；省略时使用 interaction_id。 */ key?: string;
  /** 面向用户的来源名称。 */ label?: string;
  /** 打开来源详情，由宿主处理导航及错误。 */ open_details?(): void;
}
/** 独立待处理区的输入。 */
export interface PendingInteractionAreaProps extends ChatControlMessages {
  /** 当前范围内的交互，终态自动过滤。 */ items: readonly PendingInteractionItem[];
  /** 完整来源随提交传回，私密问题标记交给宿主选择安全 transport。 */ respond(input: RespondSessionInteractionInput, private_question: boolean, item: PendingInteractionItem): Promise<void>;
}
/** 子会话面向用户的状态。 */
export type SubSessionStatus = "idle" | "working" | "action_required" | "failed" | "completed";
/** 与地址结构无关的子会话展示数据。 */
export interface SubSessionItem<Address = unknown> {
  /** 跨 Agent 与 Session 唯一的行标识。 */ key: string;
  /** 宿主自己的完整导航地址，SDK 原样传回。 */ address: Address;
  /** 标题；空值使用本地化默认标题。 */ title: string;
  /** 相对根会话的层级，直接子会话为一。 */ depth: number;
  /** 当前可见状态。 */ status: SubSessionStatus;
}
/** 子会话列表及宿主导航。 */
export interface SubSessionListProps<Address = unknown> extends ChatControlMessages {
  /** 父节点优先排列的已加载后代。 */ items: readonly SubSessionItem<Address>[];
  /** 打开选中地址；失败会在列表中显示。 */ on_select(address: Address): Promise<void>;
}
/** 分类共用的紧凑标题行。 */
export interface StatusPanelHeaderProps {
  /** 本地化分类标题。 */ title: string;
  /** 可选来源与详情入口。 */ source?: ReactNode;
  /** 分类整体动作。 */ actions?: ReactNode;
}
/** 一个会话的完整状态面板。 */
export interface StatusPanelProps<Address = unknown> extends ChatControlMessages {
  /** 当前会话的本地队列。 */ queue?: MessageQueueProps;
  /** 已解析来源的交互与响应动作。 */ interactions?: PendingInteractionAreaProps;
  /** 当前会话首次出现待处理交互时自动展开一次；支持异步加载，手动操作后取消，默认关闭。 */ auto_expand_interactions?: boolean;
  /** 已加载子会话与导航动作。 */ sub_sessions?: SubSessionListProps<Address>;
  /** 来源解析或详情操作错误。 */ error?: string;
  /** 完整会话身份；变化时释放所有临时状态，包括尚未提交的私密值。 */ session_key: string;
}

/** 队列文档内附件与引用的独立展示。 */
export interface QueuedMessageResourcesProps {
  /** 队列保存的完整编辑文档。 */ input: JSONContent;
  /** 可选宿主附件与引用渲染器。 */ host?: Pick<ChatInputHost, "render_attachment" | "render_reference">;
}

/** 分类标识；空串表示收起。 */
export type StatusTab = "queue" | "interaction" | "sub_sessions" | "";
/** 分类图标、名称与数量。 */
export interface StatusPillLabelProps {
  /** 仅作视觉提示的图标。 */ icon: ReactNode;
  /** 不含数量的本地化名称。 */ label: string;
  /** 当前条目数。 */ count: number;
}
/** 可独用的子会话状态图标。 */
export interface SubSessionStatusIconProps extends ChatControlMessages {
  /** 当前会话对用户可见的状态。 */ status: SubSessionStatus;
}
