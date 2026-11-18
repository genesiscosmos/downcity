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
 * Agent 在 Chat 中采用左侧气泡，身份、操作与运行信息位于气泡外；Work 使用无身份行的全宽文稿。
 * 用户消息采用右侧浅底圆角气泡与下方元信息行。
 * 两种表面、两种角色都由 SDK 的消息组件消费这里的类名——
 * **不要在组件里就地补类名**，那正是分叉的起点。
 *
 * Markdown 正文由 @downcity/ui 的 MarkdownView 管理局部字号与 1.65 行高。
 * 本模块负责消息外壳布局和纯文本折叠预览，不控制 Markdown 内部排版。
 */

export type { MessageIdentity } from "../types/chat-message";

// ---------------------------------------------------------------------------
// Agent 消息
// ---------------------------------------------------------------------------

/** Agent 消息根容器：完整文稿宽度，上下各留 16px 区分相邻发言。 */
export const agent_message_root_class_name = "group group/agent-message is-agent flex w-full flex-col py-4";

/** 连续回复的后续消息仅留 4px 上间距，仍保留独立 article 与操作边界。 */
export const agent_message_continuation_class_name = "pt-1";

/** 连续回复尚有后续消息时去掉下留白；组尾恢复原有外边距。 */
export const agent_message_continues_class_name = "pb-0";

/** 署名行与主体纵向排列，保留 10px 间隔使身份自然衔接回答。 */
export const agent_message_stack_class_name = "flex min-w-0 w-full flex-col gap-2.5";

/**
 * 身份行容器：头像 + 名称 + 右侧附加控件，滚动时吸顶。
 *
 * ## 为什么吸顶
 *
 * 一条消息可以很长（长过程、长结论），滚到下半段时已经看不到这条消息是谁说的。
 * 身份行吸顶后，「当前在谁的消息里」始终可见。
 *
 * 吸顶范围由**包含块**（也就是这条消息本身）决定：它只在本条消息占用的区间内吸住，
 * 消息读完就被下一条顶走，不会跨消息悬浮。这是 `position: sticky` 的默认语义，不需要额外状态。
 *
 * ## 两个必须同时给的属性
 *
 * - `bg-background`：消息列的底色（`MainView` 的 `bg-background`）。不写背景时正文会从
 *   身份行**背后**透出来，看起来像文字叠在一起；这是吸顶最容易漏的一步。
 * - `z-10`：吸顶元素在 DOM 里排在正文之前，没有层级时后出现的正文会盖在它上面。
 *
 * `top-0` 相对滚动视口顶边，不相对正文列的 `p-2`：吸住时向上对齐到视口边缘，
 * 与“吸顶”的字面意思一致。
 */
export const agent_message_identity_header_class_name = "sticky top-0 z-10 flex min-h-6 min-w-0 items-center gap-2 bg-background";

/**
 * 完整消息内容与其下方动作栏（复制 / 引用 / 分支）的分组。
 *
 * 正文、文件和文件改动按原始顺序展示，动作栏放在全部内容下方。
 * 组内使用 `gap-1`，让动作栏贴近消息末尾。
 */
export const agent_message_actions_group_class_name = "flex min-w-0 flex-col gap-1";

/**
 * 消息动作栏（复制 / 引用 / 分支）。
 *
 * **靠左**：它跟在它所作用的正文后面，不推到行末——推到行末会与下方消息的右缘对齐，
 * 看起来像属于下一条消息。
 *
 * 高度固定 `h-6`（24px 目标尺寸），否则悬停出现时会把下方内容推一下。
 * 默认隐藏、悬停或键盘焦点进入时显示：消息正文才是内容，工具栏是次要动作。
 */
export const agent_message_actions_class_name = "message-action-toolbar pointer-events-none flex h-6 items-center gap-0.5 opacity-0 transition-opacity group-hover:pointer-events-auto group-hover:opacity-100 focus-within:pointer-events-auto focus-within:opacity-100";

/** 署名的头像与名称间隔 10px，头像上下各留 2px，保持名称垂直居中。 */
export const agent_identity_row_class_name = "flex min-w-0 items-center gap-2.5 py-0.5";

/** 消息署名头像为 28px，圆形轮廓由 AgentAvatar 统一提供，不叠加外圈或背景。 */
export const agent_identity_avatar_class_name = "size-7";

/** 名称使用 13px 常规字重与次要文字灰色，弱化署名并保留可读性。 */
export const agent_identity_name_class_name = "min-w-0 truncate text-sm font-normal text-muted-foreground";

/**
 * 正文容器占满消息列宽度，与身份行保持同一左缘。
 *
 * 外壳与活动内部使用 `gap-1`（0.25rem，默认 4px）保持紧凑。
 * 按原始顺序排列的消息 Part 由内容容器提供与 Markdown 段落一致的间距。
 * Markdown 首尾外边距清零，内部段落、列表与代码块继续使用文档自身的排版节奏。
 *
 * `text-base` 为附属内容提供默认字号；Markdown 正文的字号和行高由 MarkdownView 管理。
 * 不添加 `pl-*` / `ml-*`，避免正文与身份行的左缘错开。
 */
export const agent_message_body_class_name = "flex min-w-0 w-full flex-col gap-1 text-base text-foreground";

/** Chat 正文使用左对齐浅底气泡；宽度随内容收缩，长内容最多占满消息列。 */
export const agent_message_bubble_class_name = "mr-auto w-fit min-w-0 max-w-full rounded-message bg-surface-subtle px-3.5 py-2.5 text-foreground";

/** Work 正文占满消息列，使用文稿布局并保留内部活动与正文的原始顺序。 */
export const agent_message_work_content_class_name = "min-w-0 w-full text-foreground";

/**
 * 用户消息的纯文本折叠预览排版；截断后不适合解析 Markdown 的文本使用此类名。
 * 预览通过 chat-text-size-content 消费对话字号，并复用公共写作字体与行高。
 * Markdown 正文由 MarkdownView 自主管理，不受此常量控制。
 */
export const user_message_text_class_name = "downcity-writing-text chat-text-size-content";

/** 活动块容器与正文同宽，使用统一的 4px 块间距，不附加缩进和上下留白。 */
export const agent_message_process_class_name = "flex min-w-0 w-full flex-col gap-1 text-base text-foreground";

/**
 * 按原始顺序排列全部消息 Part，与 Markdown 段落共用 --markdown-flow-ratio。
 * 使用当前对话正文字号计算间距，避免工具或附件自身的字号影响 Part 间的阅读节奏。
 * 范围外回退到 Markdown medium；`data-chat-content-region` 为展开和收起时保留阅读位置提供定位区域。
 */
export const agent_message_content_class_name = "flex min-w-0 w-full flex-col gap-[calc(var(--chat-text-size,0.875rem)*var(--markdown-flow-ratio))] text-base text-foreground";

/**
 * Footer：运行状态、实时文件改动与消息操作栏的共用行。
 *
 * 起点与正文相同（不要加 `pl-1`），高度固定，避免悬停出现操作栏时整行跳动。
 */
export const agent_message_footer_class_name = "agent-message-footer flex h-6 min-h-6 shrink-0 items-center gap-2";

// ---------------------------------------------------------------------------
// 用户消息
// ---------------------------------------------------------------------------

/** 用户消息根容器：整行占满、内容靠右。 */
export const user_message_root_class_name = "group is-user flex w-full items-end justify-end gap-2 py-4";

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

/**
 * 用户气泡：略深的中性底色、紧凑内边距，四角统一使用消息圆角令牌。
 * 左右 14px、上下 8px 内边距，配合正文行高形成均衡留白与紧凑高度。
 * 单行与多行均保持四角相同的 1.25rem 半径。
 */
export const user_message_bubble_class_name = "ml-auto w-fit max-w-full overflow-hidden rounded-message bg-surface-emphasis px-3.5 py-2 text-foreground";

/** 就地编辑时的容器：不要气泡外观，编辑器自带边框与背景。 */
export const user_message_editor_class_name = "ml-auto flex w-full max-w-full flex-col overflow-visible text-foreground";

/**
 * 气泡下方的元信息行：时间与消息操作。
 *
 * `h-6` 固定高度，悬停出现操作时才不会把下方消息推走；
 * 两个表面都用这一份，Group 的「已读」标记因此与 Session 的时间戳同处一线。
 */
export const user_message_meta_class_name = "flex h-6 items-center gap-1";

/**
 * 折叠开关：常显（不能靠 hover，否则收起后看不出「还有内容」）。
 *
 * `h-6`（24px）是 WCAG 2.2 目标尺寸下限，也是消息区域内其它图标按钮的高度；
 * `-ml-1.5` 将按钮从正文左缘向左移 6px，使按钮左侧距气泡边缘 8px，与下方留白一致。
 * 按钮内部保留 `px-1`，文字与图标不贴近点击区域边缘。
 *
 * 它是普通流里的一行，不是浮层：代码块先前的教训是浮层会被滚动内容穿过，
 * 且必然压住首行或末行文字。
 */
export const user_message_collapse_button_class_name = "-ml-1.5 mt-0.5 flex h-6 items-center gap-0.5 rounded-control px-1 text-2xs font-medium text-muted-foreground outline-none transition-colors hover:bg-interaction-hover hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/30 [&_svg]:size-3.5 [&_svg]:shrink-0";
