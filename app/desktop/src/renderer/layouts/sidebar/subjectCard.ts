/**
 * 主体行的形状：**折叠与展开共用同一个盒子**，所以切换时布局不动。
 *
 * ## 位置由「居中」决定，不由高度撑满
 *
 * 行内容是「名称一行 + 描述一行」这么一个块（约 34px），它**居中**在那个 48px 的带子里。
 * 两个状态必须以完全相同的方式得到同一个居中结果，否则内容会跳。
 *
 * 关键在于带子的「内容盒」高度：
 *
 * ```
 * 折叠态：[行 min-h-12][1px 透明边框] …内容盒 46px… 内容居中
 * 展开态：[卡片 1px 边框] [行 min-h-(3rem−2px) = 46px][…内容盒 46px…] 内容居中
 * ```
 *
 * 折叠时行自己就是那个盒子，它的边框吃掉 2px，内容盒是 46px；
 * 展开时卡片把边框画在外层，行在卡片**内部**，所以行要显式退回 46px——
 * 写回 48px 会多出 2px，内容被推低。`calc(3rem − 2px)` 正是「缩放后的带高 − 钉在物理像素上的两条边框线」，
 * 与仓库的单位约定一致（rem 跟随缩放，px 不跟随）。
 *
 * 早期版本除此之外还把内容**撑满**整条带子（名称 24px + 描述 22px），
 * 那会改掉行的纵向节奏，也让名称与描述贴在带子的上下缘，反而更难看。
 *
 * ## 边框必须有，ring 不要
 *
 * 边框是这张卡的视觉语言。两个状态都画**同一条边框**（折叠透明、展开可见），
 * 否则内容盒高度不同，又会回到上面那个 2px 问题。
 * `inset-ring` 试过（不占布局），但多一圈线，在一列表里反复出现就是噪音，已弃用。
 */

/** 带子总高，**含上下 1px 边框**（border-box），设计值 3rem = 48px。 */
export const subject_row_height_class_name = "min-h-12";

/**
 * 展开态行内容的高度：卡片内容盒的高度（卡片有上下各 1px 边框）。
 *
 * 只有 46px 才能让内容与折叠态落在同一位置，见文件头。
 */
export const subject_row_expanded_height_class_name = "min-h-[calc(3rem-2px)]";

/**
 * 行内容的排版与内边距；两种状态共用同一份，保证内部元素位置一致。
 *
 * 纵向内边距不能省：内容本身只有 34px，`py-1` 是它与带子边缘之间的呼吸，
 * 也是居中计算的一部分（去掉后内容会贴到 48px 带的边缘）。
 */
const row_layout_class_name = "group/item flex items-center gap-2.5 px-1.5 py-1";

/**
 * 折叠态：行自己就是这个带子。边框透明——看不见，但占住那 1px。
 */
export const subject_item_collapsed_class_name = `${row_layout_class_name} ${subject_row_height_class_name} rounded-lg border border-transparent cursor-pointer transition-colors duration-150 [&_button]:cursor-pointer`;

/**
 * 展开态：同一个带子变成卡片，行内容与会话列表都住在里面。
 *
 * - `absolute` + `inset-x-0 top-0`：与槽位同宽同位，向下浮在后续行之上；
 * - `flex-col`：内容纵向排列在同一个盒子里，边框只画这一次；
 * - `min-h-12`：与折叠态同高；
 * - `overflow-hidden`：把列表的滚动条裁在圆角内（卡圆角 8px、列表内缩 4px、
 *   滚动条宽 5px，滚动条最外 1px 会落进圆角区域，只靠内缩挡不住）。
 */
export const subject_item_expanded_class_name = `absolute inset-x-0 top-0 z-20 flex ${subject_row_height_class_name} flex-col overflow-hidden rounded-lg border border-border bg-background`;

/** 展开态的行内容：卡片里的第一段，排版与折叠态一致，高度退回卡片内容盒。 */
export const subject_row_class_name = `${row_layout_class_name} ${subject_row_expanded_height_class_name} shrink-0`;

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
