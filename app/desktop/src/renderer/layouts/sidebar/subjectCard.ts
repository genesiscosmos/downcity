/**
 * 主体行的形状：**折叠 / 浮动 / 嵌入**三种状态共用同一个盒子，切换时行内容不跳。
 *
 * ## 三种状态
 *
 * ```text
 * 折叠  [头像] 名称 / 描述                      行自己就是这个带子（透明边框占位）
 * 浮动  ┌ 头像 名称 / 描述        ← 浮在后续行之
 *       │ 会话列表                  上，槽位占住原位
 *       └
 * 嵌入  ┌ 头像 名称 / 描述        ← 就在列表流里，
 *       │ 会话列表                  后续主体被推开
 *       └
 * ```
 *
 * 两种展开态的并存规则不同（浮动至多一个、嵌入任意多个），理由见下面的 `OpenPanels`：
 * 它们的区别不是样式，是**会不会盖住别人**。
 *
 * 但样式上两者共享**同一个卡片盒子**，差别只在定位：浮动相对槽位绝对定位、带阴影；
 * 嵌入留在文档流里、不带阴影。几何、描边、底色、圆角全部同源，所以两态之间切换
 * 不会出现行内容位移。
 *
 * ## 位置由「居中」决定，不由高度撑满
 *
 * 行内容是「名称一行 + 描述一行」这么一个块（约 34px），它**居中**在那个 48px 的带子里。
 * 三个状态必须以完全相同的方式得到同一个居中结果，否则内容会跳。
 *
 * 关键在于带子的「内容盒」高度：
 *
 * ```
 * 折叠态：[行 min-h-12][1px 透明边框]              …内容盒 46px… 内容居中
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
 * ## 边框必须有，ring 不要；阴影只给浮动
 *
 * 边框是这张卡的视觉语言。两个展开态都画**同一条边框**（折叠透明、展开可见），
 * 否则内容盒高度不同，又会回到上面那个 2px 问题。
 * `inset-ring` 试过（不占布局），但多一圈线，在一列表里反复出现就是噪音，已弃用。
 *
 * 阴影则是**浮动与嵌入之间唯一的即时区别**，因此不能省：浮动压在别的行上，
 * 需要 `shadow-lg`（应用既有的浮层级别）把事情说清楚；嵌入没有压在谁上面，
 * 就不该有阴影——否则两种状态在视觉上无从分辨，用户只能靠「下面的行有没有动」去猜。
 */

/** 带子总高，**含上下 1px 边框**（border-box），设计值 3rem = 48px。 */
export const subject_row_height_class_name = "min-h-12";

/**
 * 展开态行内容的高度：卡片内容盒的高度（卡片有上下各 1px 边框）。
 *
 * 只有 46px 才能让内容与折叠态落在同一位置，见文件头。
 */
export const subject_row_expanded_height_class_name = "min-h-[calc(3rem-2px)]";

/** 行内容的排版与内边距；三种状态共用同一份，保证内部元素位置一致。 */
const row_layout_class_name = "group/item flex items-center gap-2.5 px-1.5 py-1";

/**
 * 折叠态：行自己就是这个带子。边框透明——看不见，但占住那 1px。
 */
export const subject_item_collapsed_class_name = `${row_layout_class_name} ${subject_row_height_class_name} rounded-lg border border-transparent cursor-pointer transition-colors duration-150 [&_button]:cursor-pointer`;

/**
 * 卡片本体：两个展开态共用的盒子。
 *
 * - `flex-col`：内容纵向排列在同一个盒子里，边框只画这一次；
 * - `min-h-12`：与折叠态同高；
 * - `overflow-hidden`：把列表的滚动条裁在圆角内（卡圆角 8px、列表内缩 4px、
 *   滚动条宽 5px，滚动条最外 1px 会落进圆角区域，只靠内缩挡不住）。
 */
const card_class_name = `flex ${subject_row_height_class_name} flex-col overflow-hidden rounded-lg border border-border bg-background`;

/**
 * 浮动态：卡片相对槽位绝对定位，向下浮在后续行之上，后续主体**不动**。
 *
 * `absolute` + `inset-x-0 top-0` 与槽位同宽同位；`z-20` 抬到后续行之上；
 * `shadow-lg` 是它「压着别人」的唯一提示。
 */
export const subject_item_floating_class_name = `absolute inset-x-0 top-0 z-20 ${card_class_name} shadow-lg`;

/**
 * 嵌入态：卡片就是这一行在列表里的盒子，占自己的高度，后续主体被推开。
 *
 * 与浮动共用同一个盒子，只是回到文档流、去掉阴影——它没有浮在谁上面。
 */
export const subject_item_docked_class_name = card_class_name;

/** 展开态的行内容：卡片里的第一段，排版与折叠态一致，高度退回卡片内容盒。 */
export const subject_row_class_name = `${row_layout_class_name} ${subject_row_expanded_height_class_name} shrink-0`;

/**
 * 槽位：只在**浮动**时出现，占住这一行在列表里的位置（后面的主体不会因浮动而移动）。
 *
 * 与折叠态的行同高，因此浮动前后列表的其余部分完全不动。
 * 嵌入态不需要它——卡片自己就占着那一行。
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

/**
 * 嵌入态里直接列出的会话条数上限；超出的部分收进「全部对话」菜单。
 *
 * 为什么嵌入要封顶而浮动不用：嵌入是**长期占位**——卡片留在列表流里，占的高度就是
 * 从主体列表里永久拿走的高度。不封顶时，一个开了 30 条会话的 Agent 会把其余主体全部
 * 推到屏幕外，而用户此刻只想看「最近几条 + 还有更多」这件事。
 *
 * 浮动不封顶：它点外部就收，高度不是长期代价，而且它本来就盖着下面的行，
 * 多显示几条不多占任何人的位置；现在靠 `max-h-80` 滚动兜住。
 *
 * 4 的来历：嵌入式面板本身是「同时盯着几个 Agent」的工作台，真正需要一眼看到的对话
 * 通常在 3~5 条；4 条 + 新建行 + 更多行 ≈ 6 行，是侧栏里一块既看得清又不喧宾夺主的尺寸。
 */
export const docked_visible_session_count = 4;

/**
 * 按上限切出「直接列出的」与「需要另开菜单的」会话。
 *
 * 做成纯函数而不是写在组件里：缝界只有一处（第 N 条与第 N+1 条之间），
 * 而它恰好是最容易写错的地方（`slice(0, n)` 写成 `slice(0, n - 1)` 时界面仍然正常，
 * 只是少显示一条）。不传上限时全部直接列出。
 *
 * 注意返回值里的 `all`：菜单要列**全部**而不只是被挡住的那几条——用户点它时的心态是
 * 「我要找的那条不在上面」，此时还要在“上面几条”和“菜单里几条”之间做除法，
 * 等于把上限这件事泄漏给了用户。
 */
export function split_visible_sessions<T>(conversations: readonly T[], max_visible?: number): {
  /** 直接列在面板里的。 */
  visible: readonly T[];
  /** 是否需要用「全部对话」菜单兜住剩下的。 */
  has_more: boolean;
} {
  if (max_visible === undefined || conversations.length <= max_visible) {
    return { visible: conversations, has_more: false };
  }
  return { visible: conversations.slice(0, max_visible), has_more: true };
}

/**
 * ## 三种状态：两个展开态的**并存规则不同**
 *
 * ```text
 * 折叠  全部收起
 * 浮动  至多一个（瞬态预览）
 * 嵌入  任意多个（固定住的工作台）
 * ```
 *
 * 这不是“一次只能开一个”的同一条限制写了两遍，而是两种展开态本身性质不同：
 *
 * - **浮动会盖住后续行**（它是绝对定位的），两个同时存在就必然互相遮挡，或者说上面那个
 *   盖住下面那个的头部——那个头部正是它的开关，被盖住就点不到了。所以浮动至多一个。
 * - **嵌入在列表流里各占一段**，互不遮挡。因此可以多个同时存在，
 *   而“独立”就是它的全部价值：同时盯着几个 Agent 的对话，切来切去不用重新展开。
 *
 * 由此推出两个收尾手势的适用范围：点外部、Esc 都只作用于**浮动**那一个。它们本来就是
 * “退回一步”的顺带动作，而嵌入是用户明确按下了固定开关才得到的，
 * 不该被一个顺带动作撤销（那跟右下角那个已经按下的固定图标自相矛盾）。
 */

/**
 * 会话面板的展开方式。
 *
 * - `floating`：浮在列表之上，不占后续主体的位置，**点外部与 Esc 都能收起**——它盖住了
 *   下面的行，不这样就没有别的办法去点被盖住的那一行。全列表至多一个。
 * - `docked`：嵌进列表流里，占自己的高度、把后续主体推开。它不盖住任何东西，
 *   所以没有“点开外部就收起”这回事；要收起只能点头像（或面板上的固定开关）。可多个并存。
 *
 * 单独建模而不是复用「展开 + 固定」两个布尔值：那两个布尔值能表达出
 * 「未展开但已固定」这种不存在的组合，而这里恰好只有两个合法展开态。
 */
export type SubjectPanelMode = "floating" | "docked";

/**
 * 全部展开中的会话面板。
 *
 * 一个浮动 + 一组嵌入，而不是“一个 key + 一个方式”：后者只能描述“当前那一个”的开合，
 * 嵌入态的独立性（互不影响、可多个）就无从表达。
 */
export interface OpenPanels {
  /** 浮动着的那一个；null 表示没有。形状上就限定了至多一个。 */
  floating_key: string | null;
  /** 嵌入着的那几个。**不用集合而用数组**：它只用来判断成员，顺序不参与渲染（行的顺序由主体列表决定）。 */
  docked_keys: readonly string[];
}

/** 没有任何展开的面板。共享常量，便于引用比较。 */
export const no_open_panels: OpenPanels = { floating_key: null, docked_keys: [] };

/** 读出某个主体当前的展开方式；没展开时为 null。 */
export function panel_mode_of(panels: OpenPanels, key: string): SubjectPanelMode | null {
  if (panels.docked_keys.includes(key)) return "docked";
  return panels.floating_key === key ? "floating" : null;
}

/**
 * 头像点击要推进到的下一个状态：**折叠 → 浮动 → 嵌入 → 折叠**。
 *
 * 把「点一次头像会到哪」做成纯函数而不是散在组件里：这是整套交互的**全部契约**，
 * 能独立验证，也就不会在改样式时被顺手改坏。
 *
 * 注意它只回答“这一个”的下一个状态，不回答“其他面板怎么办”——那个问题由
 * `advance_open_panels` 回答（答案是：它们一概不动）。
 */
export function next_subject_panel_mode(mode: SubjectPanelMode | null): SubjectPanelMode | null {
  if (mode === null) return "floating";
  return mode === "floating" ? "docked" : null;
}

/**
 * 把某个主体设成指定的展开方式（`null` 收起），**只动这一个**。
 *
 * 两个不变量在这里维持：
 *
 * 1. 同一个 key 不会既浮动又嵌入（先把它从两边都摘掉，再按目标放回去）；
 * 2. 浮动的至多一个（设为浮动时会挤掉原来那个，而原来那个只是**回到折叠**，
 *    不是变成嵌入——否则“点开 B”会凭空给 A 留下一个它的用户没要过的固定面板）。
 */
export function set_open_panel_mode(panels: OpenPanels, key: string, mode: SubjectPanelMode | null): OpenPanels {
  const docked_keys = panels.docked_keys.filter((item) => item !== key);
  const floating_key = panels.floating_key === key ? null : panels.floating_key;
  if (mode === "floating") return { floating_key: key, docked_keys };
  if (mode === "docked") return { floating_key, docked_keys: [...docked_keys, key] };
  return { floating_key, docked_keys };
}

/** 头像点击：推进这一个的展开循环，其他面板一概不动。 */
export function advance_open_panels(panels: OpenPanels, key: string): OpenPanels {
  return set_open_panel_mode(panels, key, next_subject_panel_mode(panel_mode_of(panels, key)));
}

/**
 * 丢掉已经不在列表里的主体（被删除、切换 Workspace）。
 *
 * 不清理的话，那个 key 将来被复用时会“记得”之前是展开的；而 key 是拼出来的，
 * 复用并非不可能。
 *
 * 没有任何变化时**原样返回入参**：调用方拿它做派生值时，引用稳定才能让下面的 memo 不白算。
 */
export function retain_open_panels(panels: OpenPanels, keys: readonly string[]): OpenPanels {
  const docked_keys = panels.docked_keys.filter((key) => keys.includes(key));
  const floating_key = panels.floating_key !== null && keys.includes(panels.floating_key) ? panels.floating_key : null;
  if (docked_keys.length === panels.docked_keys.length && floating_key === panels.floating_key) return panels;
  return { floating_key, docked_keys };
}
