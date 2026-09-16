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
 *
 * 消息正文的**文字排版**（字号与行高）同样归这里：`styles/markdown.css` 的标题、列表、
 * 引用、表格与代码全部按 em 相对值派生，基准字号一旦落到组件里，各消费处就会各自定义一套阅读节奏。
 * 见 `chat_message_text_class_name`。
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
 * ## 为什么需要块间距
 *
 * 容器的直接子节点就是这条消息的展示块：正文、活动（Reasoning / Tool / Action）、
 * 文件、文件改动、错误。`styles/markdown.css` 已把正文块的首/尾外边距清零
 *（避免容器被首尾留白撑开），所以如果不在这里给间距，正文与紧随其后的工具活动行会**完全贴住**，
 * 看起来就像同一段文字的上下两行。
 *
 * ## 三个量级的约束（改这个值前必读）
 *
 * | 层级 | 值 | 来源 |
 * | --- | --- | --- |
 * | Markdown 段落之间 | 0.5em = 0.45rem（`base` 正文） | `styles/markdown.css` |
 * | 消息内的块之间 | `gap-3` = 0.75rem | 这里 |
 * | 两条消息之间 | 根容器 `py-2`，合计 1rem | `agent_message_root_class_name` |
 *
 * 它是**夹在中间的一档**：大于段落间距（否则「另起一段」与「后面跟了工具活动」看起来一样宽），
 * 小于消息间距（否则同一条消息被读成两条）。
 *
 * 三个值都是相对单位（em / rem），界面缩放时等比走，因此上面的比值关系与缩放无关。
 * 但注意：段落间距随**字号**走（0.5em），而字号是会被反复调的值。
 *
 * 块间距从 0.625rem 抬到 0.75rem，是为了给「默认档定在 `base`」留出余量：
 * 在 `base`（0.9rem）下段落间距是 0.45rem，与块间距差 0.3rem（= 4.8px）；
 * 若沿用 0.625rem，差值只有 0.175rem（= 2.8px），两个层级会几乎分不出来。
 * 由此得出正文的**字号上限**：`0.5 × 字号 ≤ 0.75 − 0.125` ⇒ 不得超过 `xl`（1.25rem）。
 * 这条约束由 `chat_message_layout.test.ts` 以「同一根字号下的换算」守着。
 *
 * 容器上的 `text-base` 只是给没有自己声明字号的附属内容兜底（活动行、交互卡片、文件 chip
 * 都各自声明了 `xs` / `2xs` / `3xs`）；正文文字由 `chat_message_text_class_name` 单独给出阅读字号。
 *
 * 不要给它加 `pl-*`/`ml-*`：那会重新把正文和身份行分开成两条竖线。
 */
export const agent_message_body_class_name = "flex min-w-0 w-full flex-col gap-3 text-base text-foreground";

/**
 * 消息正文与 Composer 共用的阅读排版：字号与行高只有这一处。
 *
 * ## 为什么四处必须同值
 *
 * - **Composer ↔ 用户气泡**是同一段文字在发送前后的两种状态；不一致就会出现
 *   「按下回车，文字突然变小」，而那只在发送瞬间可见。
 * - **Agent 正文 ↔ 用户消息**是明确的产品要求（对话两侧对照着读）。
 * - **Session ↔ Group** 两侧的同一种发言，不同值等于同一个 Agent 的长相不一致。
 *
 * 消费处：`AgentMessageContent`、`UserMessageContent`、`GroupView`（两种角色），
 * 以及 `base.css` 的 `.chat-input-editor`（Composer）。前四处用本常量，
 * Composer 用 `var()`；两边都指向 `tokens.css` 的 `--text-base` + `--leading-reading`。
 *
 * ## 为什么用 `base`（0.9rem）
 *
 * 它是全应用「普通文字」的**默认档**：不特别说明就用它。
 * 0.9rem 是本应用自有的数值（Tailwind 的 `base` 是 1rem）——默认档定在 `base`
 * （名字语义正确）与「正文 ⩽ 约 14px」（尺寸合适）两个要求相交处。
 * 档位对照见 `tokens.css`。
 *
 * 与块间距的关系是硬约束：段落间距 0.5em（= 0.45rem）与块间距（`gap-3` = 0.75rem）
 * 差 0.3rem（= 4.8px），在两个层级之间留出了可感知的差值，
 * 同时也给出正文字号的**上限 `xl`**（1.25rem）。
 *
 * `--leading-reading` 同时被 Composer 引用（`base.css` 的 `.chat-input-editor`）。
 *
 * ## 行高为什么单独用 `leading-reading`
 *
 * `text-base` 的配对行高是 1.3rem，是 UI 文本的密度；
 * 正文是长段落，需要 1.8。两者是有意分开的：`leading-*` 会盖掉配对行高，
 * 所以这里同时写 `text-base leading-reading`，不引入新的字号档位。
 *
 * ## 历史：为什么曾经不能用 Tailwind 工具类
 *
 * 这里以前是一个定义在 `styles/chat.css` 的普通类 `.chat-message-text`，原因不是审美，
 * 而是缺陷：`cn()`（tailwind-merge）不认识自定义字号，会把它归入「文字颜色」组，
 * 于是 `cn("… text-foreground", 本常量)` 把字号当作冲突颜色**静默删除**，
 * 连續八轮「改字号没反应」就是它造成的。
 *
 * 现在修根因：`lib/utils.ts` 用 `extendTailwindMerge` 把 9 个档位注册进 `font-size` 组，
 * `text-size-N` 不再与 `text-<颜色>` 冲突。因此本常量可以直接用语义字号工具类，
 * 不再需要普通类这个绕过手段。机制与回归验证见 `tests/font_scale.test.ts`。
 */
export const chat_message_text_class_name = "text-base leading-reading text-foreground";

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
export const user_message_bubble_class_name = "ml-auto w-fit max-w-full overflow-hidden rounded-2xl rounded-tr-none bg-surface-subtle px-3 py-2 text-foreground";

/** 就地编辑时的容器：不要气泡外观，编辑器自带边框与背景。 */
export const user_message_editor_class_name = "ml-auto flex w-full max-w-full flex-col overflow-visible text-foreground";

/**
 * 气泡下方的元信息行：时间与消息操作。
 *
 * `h-6` 固定高度，悬停出现操作时才不会把下方消息推走；
 * 两个表面都用这一份，Group 的「已读」标记因此与 Session 的时间戳同处一线。
 */
export const user_message_meta_class_name = "flex h-6 items-center gap-1";
