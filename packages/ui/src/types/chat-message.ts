/** 消息展示的可移植契约；领域状态、导航与 Power 渲染由宿主拥有。 */
import type { CSSProperties, ReactNode, Ref } from "react";
import type { DowncityChatMessage, DowncityChatPanelProps } from "./chat";
import type { MarkdownViewTextSize } from "../components/markdown/markdown_text_size";
/** 只用于展示的 Agent 身份。 */
export interface MessageIdentity {
  /** Agent 稳定标识。 */ agent_id: string;
  /** 可选展示名称。 */ name?: string;
  /** 可选头像地址。 */ avatar_url?: string;
}
/** Agent 输出、连续回复与运行信息的通用展示。 */
export interface AgentMessageProps {
  /** 规范化消息；独立运行状态行可以省略。 */ message?: DowncityChatMessage;
  /** 身份数据；默认展示 Agent。 */ agent?: MessageIdentity;
  /** 覆盖默认正文，用于宿主的业务 Part renderer。 */ children?: ReactNode;
  /** 是否展示身份；连续回复承接行通常关闭。 */ show_identity?: boolean;
  /** 是否承接上一条同 Turn 消息。 */ continues_previous?: boolean;
  /** 是否仍有后续同 Turn 消息。 */ continues_next?: boolean;
  /** 创建时间，毫秒时间戳。 */ created_at?: number;
  /** 宿主头像，省略时使用身份中的 URL 或默认首字母。 */ avatar?: ReactNode;
  /** 宿主时间显示，省略时使用本地时间。 */ timestamp?: ReactNode;
  /** 点击身份时打开宿主配置或资料。 */ identity_action?(): void;
  /** 身份操作提示。 */ identity_title?: string;
  /** 身份操作的可访问名称。 */ identity_label?: string;
  /** 身份名称后的状态说明。 */ suffix?: ReactNode;
  /** 标题行末端的操作。 */ header_action?: ReactNode;
  /** 正文下方操作；null 显式隐藏默认复制操作。 */ actions?: ReactNode;
  /** 运行状态；Chat 位于气泡内部正文上方，空正文时也创建气泡；Work 位于紧凑底栏。 */ status?: ReactNode;
  /** 正文与动作栏之后的补充信息，例如实时文件改动。 */ footer?: ReactNode;
  /** 流式生成状态。 */ busy?: boolean;
  /** 用于宿主位置测量。 */ row_ref?: Ref<HTMLElement>;
  /** 正式消息 article 或瞬时状态 div。 */ semantic?: "message" | "status";
  /** 当前 Session 的 Interaction 响应能力。 */ on_respond_interaction?: DowncityChatPanelProps["on_respond_interaction"];
  /** 自定义业务交互展示。 */ render_interaction?: DowncityChatPanelProps["render_interaction"];
  /** 重试当前可恢复的消息。 */ retry_message?(message_id: string): Promise<void>;
  /** 是否允许提交重试。 */ can_retry?: boolean;
}
/** 用户气泡与编辑表面的通用展示。 */
export interface UserMessageProps {
  /** 规范化用户消息；自定义编辑表面可以省略。 */ message?: DowncityChatMessage;
  /** 自定义正文或编辑器。 */ children?: ReactNode;
  /** 下方元信息，时间、已读和宿主操作。 */ meta?: ReactNode;
  /** 编辑态使用展开的无气泡布局。 */ editing?: boolean;
  /** 工作表面的紧凑间距。 */ compact?: boolean;
  /** 正文 Markdown 字号。 */ text_size?: MarkdownViewTextSize;
  /** 可选纯文本/Markdown 折叠预览。 */ preview?: { /** 折叠态文本。 */ text: string; /** 预览被截断，不按 Markdown 解析。 */ plain?: boolean } | null;
  /** 可控展开状态；省略时组件持有。 */ expanded?: boolean;
  /** 展开选择变化，宿主可持久化展示状态。 */ on_expanded_change?(expanded: boolean): void;
  /** 展开按钮文案。 */ expand_label?: string;
  /** 收起按钮文案。 */ collapse_label?: string;
  /** 宿主可覆盖的气泡样式。 */ style?: CSSProperties;
}
