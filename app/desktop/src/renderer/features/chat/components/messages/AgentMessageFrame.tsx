/**
 * Agent 消息的共享左右布局，供 Session、Group 和运行状态行使用。
 * 左列固定承载头像与可选折叠按钮；右列依次承载名称、时间、主体及底部内容。
 * 几何统一来自 message_layout，折叠状态与消息操作由调用方持有。
 */

import type { ReactNode, Ref } from "react";
import { cn } from "@/lib/utils";
import { AgentAvatar } from "@/components/AgentAvatar";
import { ChatMessageTimestamp } from "@/features/chat/components/ChatMessageTimestamp";
import { agent_identity_avatar_class_name, agent_identity_name_class_name, agent_identity_row_class_name, agent_message_body_class_name, agent_message_footer_class_name, agent_message_identity_header_class_name, agent_message_root_class_name, agent_message_rail_class_name, agent_message_stack_class_name, type MessageIdentity } from "@/features/chat/components/messages/message_layout";

/** Agent 消息骨架属性，所有交互由调用方注入。 */
export interface AgentMessageFrameProps {
  /** 当前 Agent 的身份；名称为空时使用 Agent。 */
  agent: MessageIdentity;
  /** 消息创建时间；状态行可省略。 */
  created_at?: number;
  /** 点击头像或名称时执行的身份操作。 */
  identity_action?(): void;
  /** 身份操作的悬停提示。 */
  identity_title?: string;
  /** 身份按钮的可访问名称。 */
  identity_label?: string;
  /** 名称后的附加状态说明。 */
  suffix?: ReactNode;
  /** 左列头像下方的操作，通常为过程折叠按钮。 */
  rail_action?: ReactNode;
  /** 是否正在生成，用于正式消息的 aria-busy。 */
  busy?: boolean;
  /** 消息根元素引用，供调用方测量位置。 */
  row_ref?: Ref<HTMLElement>;
  /** 右列主体，包括消息内容、文件改动和消息操作。 */
  children?: ReactNode;
  /** 右列底部的附加运行信息。 */
  footer?: ReactNode;
  /** 正式消息使用 article，瞬时状态行使用 div。 */
  semantic?: "message" | "status";
}

/** 组合左侧身份列和右侧消息内容，保持两个表面的布局一致。 */
export function AgentMessageFrame({ agent, created_at, identity_action, identity_title, identity_label, suffix, rail_action, busy = false, children, footer, semantic = "message", row_ref }: AgentMessageFrameProps) {
  const name = agent.name || "Agent";
  const avatar = <AgentAvatar agent={agent} class_name={agent_identity_avatar_class_name} />;
  const identity_button_class = "rounded-control outline-none focus-visible:ring-2 focus-visible:ring-ring/30";
  const content = <>
    <div className={agent_message_rail_class_name}>
      {identity_action
        ? <button type="button" onClick={identity_action} title={identity_title} aria-label={identity_label ?? identity_title ?? name} className={cn("shrink-0", identity_button_class)}>{avatar}</button>
        : avatar}
      {rail_action}
    </div>
    <div className={agent_message_stack_class_name}>
      <header className={agent_message_identity_header_class_name}>
        {identity_action
          ? <button type="button" onClick={identity_action} title={identity_title} aria-label={identity_label ?? identity_title ?? name} className={cn(agent_identity_row_class_name, identity_button_class, "max-w-full hover:underline")}><span className={agent_identity_name_class_name}>{name}</span></button>
          : <div className={agent_identity_row_class_name}><span className={agent_identity_name_class_name}>{name}</span></div>}
        {suffix}
        {created_at ? <ChatMessageTimestamp created_at={created_at} /> : null}
      </header>
      {children ? <div className={agent_message_body_class_name}>{children}</div> : null}
      {footer ? <div className={agent_message_footer_class_name}>{footer}</div> : null}
    </div>
  </>;
  if (semantic === "status") return <div ref={row_ref as Ref<HTMLDivElement>} className={agent_message_root_class_name}>{content}</div>;
  return <article ref={row_ref as Ref<HTMLElement>} className={agent_message_root_class_name} aria-busy={busy}>{content}</article>;
}
