/**
 * Chat 消息行（Agent 与用户）共用的布局类名。
 *
 * ## 为什么必须共用一份
 *
 * 同一套消息结构出现在两个表面上：Agent Session Chat 与 Group 共享消息。
 * 两处各写一遍 DOM 的结果是同一件事有三种视觉——例如 Agent 正文左缘曾出现
 * 「头像列宽 28px + 间距 8px」与「头像列宽 32px + px-1」两套值，用户消息的元信息行
 * 也一度是 `h-6 gap-1` 与 `gap-1.5 px-1` 两种写法。
 *
 * 更早的 Agent 布局是「头像占左侧一列、正文右移」，由此带出三个问题：
 *
 * 1. 正文左缘与身份行、与工具活动各错开一次，整列没有统一的左边缘；
 * 2. 头像带 `sticky`，长消息滚动时它脱离自己的 Header 悬在视口上；
 * 3. 头像与名称是两个按钮却只做同一个动作，键盘用户要为同一件事按两次 Tab。
 *
 * 现在 Agent 消息是上下两段（身份在上、正文在下），用户消息是右侧气泡 + 下方元信息行。
 * 两个表面、两种角色都由 layouts 里的 frame 组件消费这里的类名——
 * **不要在组件里就地补类名**，那正是分叉的起点。
 */

/** Agent 身份行的最小输入：与 AgentAvatar 的入参一致，Group 侧可能只有 id。 */
export interface MessageIdentity {
  /** Agent 标识。 */
  agent_id: string;
  /** Agent 用户可见名称。 */
  name?: string;
  /** 自定义头像地址。 */
  avatar_url?: string;
}

// ---------------------------------------------------------------------------
// Agent 消息
// ---------------------------------------------------------------------------

/**
 * Agent 消息根容器：上下两段（身份在上、正文在下），宽度占满消息列。
 *
 * `flex-col` 是这条布局的核心：内容是列，不是「头像列 + 正文列」的一行。
 */
export const agent_message_root_class_name = "group is-agent flex w-full flex-col gap-1 py-2 !m-0 !p-0";

/**
 * 身份行：头像 + 名称。
 *
 * `py-0.5` 让 20px 头像达到 24px 触控高度，同时也定义了身份行的高度（24px）——
 * 消息与「思考中」状态行靠它对齐正文的起点。
 */
export const agent_identity_row_class_name = "flex min-w-0 items-center gap-1.5 py-0.5";

/** 身份行头像：20px。身份行是一行标签，不是头像展示位，不必占 28px。 */
export const agent_identity_avatar_class_name = "size-5 rounded";

/**
 * 正文容器：占满消息列宽度，左缘就是消息列左缘。
 *
 * 不要给它加 `pl-*`/`ml-*`：那会重新把正文和身份行分开成两条竖线。
 */
export const agent_message_body_class_name = "flex min-w-0 w-full flex-col gap-0 text-sm text-foreground";

/**
 * Footer：运行状态与消息操作栏的共用行。
 *
 * 起点与正文相同（不要加 `pl-1`），高度固定，避免悬停出现操作栏时整行跳动。
 */
export const agent_message_footer_class_name = "agent-message-footer flex h-6 min-h-6 shrink-0 items-center";

// ---------------------------------------------------------------------------
// 用户消息
// ---------------------------------------------------------------------------

/** 用户消息根容器：整行占满、内容靠右。 */
export const user_message_root_class_name = "group is-user flex w-full items-end justify-end gap-2 py-2";

/**
 * 气泡与元信息行的纵向堆叠。
 *
 * `items-end` 让气泡与元信息行共右边缘；`max-w` 由展开态决定（见下）。
 */
export const user_message_stack_class_name = "user-message-stack flex w-full min-w-0 flex-col items-end gap-0.5";

/** 常规态最大宽度：气泡不超过消息列的 80%，但绝不宽于 42rem。 */
export const user_message_stack_max_class_name = "max-w-[min(80%,42rem)]";

/** 展开态最大宽度：就地编辑时放宽到 42rem，编辑器需要更多水平空间。 */
export const user_message_stack_expanded_class_name = "max-w-[42rem]";

/** 气泡本体：与 Agent 正文区分开的唯一手段（右侧、圆角、浅底）。 */
export const user_message_bubble_class_name = "ml-auto w-fit max-w-full overflow-hidden rounded-2xl rounded-tr-none bg-surface-subtle px-3 py-2 text-sm text-foreground";

/** 就地编辑时的容器：不要气泡外观，编辑器自带边框与背景。 */
export const user_message_editor_class_name = "ml-auto flex w-full max-w-full flex-col overflow-visible text-sm text-foreground";

/**
 * 气泡下方的元信息行：时间与消息操作。
 *
 * `h-6` 固定高度，悬停出现操作时才不会把下方消息推走；
 * 两个表面都用这一份，Group 的「已读」标记因此与 Session 的时间戳同处一线。
 */
export const user_message_meta_class_name = "flex h-6 items-center gap-1";
