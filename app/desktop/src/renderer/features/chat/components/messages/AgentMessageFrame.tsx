/**
 * Agent 侧消息行的唯一骨架。
 *
 * ## 谁在用
 *
 * - Agent Session Chat 的正式消息（`AgentMessage`）；
 * - Agent Session 的独立「思考中」状态行（`AgentRuntimeIndicator`）；
 * - Group 共享消息里的 Agent 发言、成员交互、成员输入状态（`GroupView`）。
 *
 * 这些形态在同一个滚动流里前后相接，因此必须共用同一条左边缘与同一条身份行高度；
 * 两处各写一遍 DOM 时，Group 侧的头像列是 32px、Session 侧是 28px + 间距 8px，
 * 同一件事有两种视觉。几何全部来自 `message_layout`，这里只负责组装与语义。
 *
 * ## 与 Group 的差异只有两处，都用 props 表达
 *
 * 1. **身份行的动作不同**：Session 是「打开 Agent 配置」，Group 是「@ 提及该成员」。
 *    传 `identity_action` 即为可点按钮，不传就是纯展示（如等待响应的状态行）。
 * 2. **身份行右侧可能要多一段说明**：Group 的待响应行需要在名字后补一句「需要你的响应」。
 *    这是 `suffix`，不是新的布局。
 *
 * 头像与名称是**同一个按钮**：它们做同一件事，拆成两个按钮会让键盘用户为同一动作
 * 按两次 Tab。可访问名称由调用方给出，语义不变。
 */

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { AgentAvatar } from "@/components/AgentAvatar";
import { ChatMessageTimestamp } from "@/features/chat/components/ChatMessageTimestamp";
import { agent_identity_avatar_class_name, agent_identity_name_class_name, agent_identity_row_class_name, agent_message_body_class_name, agent_message_footer_class_name, agent_message_root_class_name, type MessageIdentity } from "@/features/chat/components/messages/message_layout";

/** Agent 消息骨架属性。 */
export interface AgentMessageFrameProps {
  /** 身份行展示的 Agent；Group 侧可能只有 id，此时名称为空串并回退为 "Agent"。 */
  agent: MessageIdentity;
  /** 消息创建时间；不传则不显示（状态行没有时间）。 */
  created_at?: number;
  /** 身份行动作；不传时身份行是纯展示。 */
  identity_action?(): void;
  /** 身份行动作的悬停提示（通常是「打开配置」或「@ 名称」）。 */
  identity_title?: string;
  /** 身份行动作的可访问名称。 */
  identity_label?: string;
  /** 名称之后的附加说明，例如「需要你的响应」。 */
  suffix?: ReactNode;
  /** 是否为正在生成的消息（映射到 `aria-busy`）。 */
  busy?: boolean;
  /** 正文；为空表示这条行只有状态（如「正在输入」）。 */
  children?: ReactNode;
  /** Footer（运行状态或消息操作栏）；不传则不渲染。 */
  footer?: ReactNode;
  /**
   * 语义：`message` 是正式消息（`article`），`status` 是瞬时状态行（普通 `div`）。
   *
   * 状态行不该被读成一条消息，正式消息也不该每次变化都被播报。
   * 这里只决定**元素语义**：live region 挂在真正变化的状态文案上
   * （见 `AgentThinkingStatus`），而不是行容器——容器上再挂一个会变成嵌套播报。
   * 默认 `message`。
   */
  semantic?: "message" | "status";
}

/** 组装一条 Agent 侧行的身份行、正文与 Footer。 */
export function AgentMessageFrame({ agent, created_at, identity_action, identity_title, identity_label, suffix, busy = false, children, footer, semantic = "message" }: AgentMessageFrameProps) {
  const name = agent.name || "Agent";
  const identity_content = <>
    <AgentAvatar agent={agent} class_name={agent_identity_avatar_class_name} />
    <span className={cn(agent_identity_name_class_name, identity_action && "group-hover/identity:underline")}>{name}</span>
  </>;
  const content = <>
    <header className="flex min-w-0 items-center gap-2">
      {identity_action
        ? <button type="button" onClick={identity_action} title={identity_title} aria-label={identity_label ?? identity_title ?? name} className={cn("group/identity", agent_identity_row_class_name, "max-w-full rounded-control outline-none focus-visible:ring-2 focus-visible:ring-ring/30")}>{identity_content}</button>
        : <div className={agent_identity_row_class_name}>{identity_content}</div>}
      {suffix}
      {created_at ? <ChatMessageTimestamp created_at={created_at} class_name="opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100" /> : null}
    </header>
    {children ? <div className={agent_message_body_class_name}>{children}</div> : null}
    {footer ? <div className={agent_message_footer_class_name}>{footer}</div> : null}
  </>;
  if (semantic === "status") return <div className={agent_message_root_class_name}>{content}</div>;
  return <article className={agent_message_root_class_name} aria-busy={busy}>{content}</article>;
}
