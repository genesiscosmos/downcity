/**
 * 主体行的形状：**折叠与展开共用同一个边框盒**，所以切换时布局不动。
 *
 * ## 不变量：内容位置只由「边框 + 内边距」决定
 *
 * 折叠与展开的 DOM 不同（展开时多了卡片与列表），但那一行的**边框盒**始终存在，
 * 并且始终是 `1px 边框 + min-h-12`：
 *
 * ```
 * 折叠： [边框盒 min-h-12][边框 1px 透明][内边距 4px][行内容]        ← 行自己就是边框盒
 * 展开： [槽位 min-h-12]
 *          └ [边框盒 min-h-12][边框 1px][行内容(高 48−2)][会话列表]
 * ```
 *
 * 两处的行内容都落在「1px + 4px」之后，于是展开/收起时头像、名称、折角都不动。
 *
 * ## 为什么行内容要减掉 2px
 *
 * 边框画在**外层**（折叠时是行本身、展开时是卡片）。折叠时外层就是那个 48px 的盒子，
 * 边框在它内部占 2px；展开时外层是卡片，行内容在它**里面**，若仍写 48px，
 * 加上卡片的上下边框就会变成 50px——内容被推低 2px，展开时能看到一次轻微下移。
 * 所以行内容在「位于边框盒内部」时必须用 `48 − 2×1px`。
 *
 * 这两个值只在这里定义；写死两处就会分叉，而分叉的症状（展开时内容跳 1~2px）不报错、只看着别扭。
 *
 * ## 为什么边框从一开始就存在（透明）
 *
 * 早先折叠态没有边框，展开时才出现——那 1px 是**布局变化**的来源之一。
 * 现在折叠态就带着 `border-transparent`：看不见，但占位，于是边框的出现不影响任何位置。
 */

/** 边框盒的总高（设计值 3rem = 48px）；槽位与折叠态的行共用它。 */
export const subject_row_height_class_name = "min-h-12";

/**
 * 行内容的最小高度 = 总高 − 边框盒的上下边框（2 × 1px）。
 *
 * 只在「行内容位于边框盒内部」时使用（展开态）；折叠态的承载者就是边框盒本身，
 * 直接用 `subject_row_height_class_name`。
 */
export const subject_row_content_height_class_name = "min-h-[calc(3rem-2px)]";

/** 行内容的排版与内边距；两种状态共用同一份，保证内部元素位置一致。 */
const row_layout_class_name = "group/item flex items-center gap-2.5 px-1.5 py-1";

/**
 * 折叠态：**行自己就是那个边框盒**。
 *
 * `border-transparent` 而非「没有边框」：它要占住 1px，展开时换成可见边框才不会让内容位移。
 */
export const subject_item_collapsed_class_name = `${row_layout_class_name} ${subject_row_height_class_name} rounded-lg border border-transparent cursor-pointer transition-colors duration-150 [&_button]:cursor-pointer`;

/**
 * 展开态：同一个边框盒变成卡片，行内容与会话列表都住在里面。
 *
 * - `absolute` + `inset-x-0 top-0`：与槽位同宽同位，向下浮在后续行之上；
 * - `flex-col`：行内容与列表纵向排列在同一个盒子里，边框只画这一次；
 * - `min-h-12`：与折叠态同高，折叠时占的位与展开时一模一样；
 * - `overflow-hidden`：把列表的滚动条裁在圆角内。仅靠面板的 `px-1.5` 不够：
 *   卡圆角 8px、面板内缩 6px、滚动条宽 5px，滚动条最外 2px 恰好落进圆角区域。
 */
export const subject_item_expanded_class_name = `absolute inset-x-0 top-0 z-20 flex ${subject_row_height_class_name} flex-col overflow-hidden rounded-lg border border-border bg-background`;

/** 展开态的行内容：卡片里的第一段，排版与折叠态一致，高度按边框盒内部折算。 */
export const subject_row_class_name = `${row_layout_class_name} ${subject_row_content_height_class_name} shrink-0`;

/**
 * 槽位：只在展开时出现，占住这一行在列表里的位置（后面的主体不会因展开而移动）。
 *
 * 与折叠态的行同高，因此展开前后列表的其余部分完全不动。
 */
export const subject_slot_class_name = `relative ${subject_row_height_class_name}`;

/**
 * 卡片下半（会话列表）的容器。
 *
 * **不带内边距**：内边距属于列表内容，不属于滚动容器。
 *
 * 滚动条的横向位置由滚动容器自身的盒子决定，所以任何放在这一层的内边距都会把它从卡片右缘向内推开，
 * 看上去像悬浮在列表中间。正确分层是：
 *
 * ```
 * [滚动容器]      铺满卡片宽度、无内边距  ← 滚动条因此贴着卡片右缘
 *   └ [列表内边距] p-1                    ← 内容的内缩在这里
 * ```
 *
 * 即：**内边距要给内容，不要给滚动容器**。（见 SubjectConversationsPanel）
 */
export const subject_card_panel_class_name = "shrink-0";
