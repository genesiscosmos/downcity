/**
 * Sidebar 行契约：侧栏里每一个可点的行都从这里取值，且**只有三个变体**。
 *
 * ## 三个变体
 *
 * ```text
 * agent     [头像 32] 名称 / 描述                    ← 身份行：谁
 * default   [字形 32?] 名称                          ← 条目行：什么
 * settings  [图标 16] 名称                           ← 设置行：略高，留出呼吸
 * ```
 *
 * | 变体 | 行首槽 | 行高 | 文字线 | 用在哪 |
 * | --- | --- | --- | --- | --- |
 * | `agent` | 32（头像；图标 16 居中） | 44 / 48 | 96 | Agents 主体行、Power 条目 |
 * | `default` | 无、16 或 32 | 32 | 56 / 80 / 96 | 会话行、新建行、树行 |
 * | `settings` | 16 | 40 | 80 | 设置导航 |
 *
 * ## 两条线各自回答一件事
 *
 * - **96 是身份线**：行首是一个 32px 的头像，「这是谁」先于「它叫什么」。
 * - **56 是内容线**：行首没有头像，文字直接落在内容起点上，与面板标题同一条线。
 *
 * 之前的问题不是这两条线不同，而是**同一类东西落在五条线上**——以侧栏左缘起算，
 * 行文字分布在 80 / 84 / 88 / 94 / 96，行首图标分布在 64 / 66 / 70 / 72。
 * 现在同类东西只有一条线，差别只来自「这一行要不要行首槽」，而槽宽只有三档。
 *
 * 而 96 正是「内容起点 56 + 32 槽 + 8 间距」——身份行与「带 32 槽的条目行」同线，
 * 这是有意的：两者的行首都是 32px 的实物，文字自然落在同一列。
 *
 * ## 文字线是怎么来的
 *
 * ```text
 * 行盒起点 = Rail 40 + 内容内边距 8      = 48
 * 内容起点 = 48 + 行内边距 8             = 56
 * 文字线   = 内容起点 + 行首槽 +（有槽时再加 8 的间距）
 * ```
 *
 * 三个变体共用同一份内容起点：`agent` 行曾经带一条 1px 透明边框，
 * 那是为了让它在展开成卡片时内容盒与折叠态重合。卡片没了之后，
 * 这条边框（以及它带来的 97）也就没有存在的理由了。
 *
 * ## 为什么行高不写死，而要能推出来
 *
 * | 行 | 槽 | 高 | 推导 |
 * | --- | --- | --- | --- |
 * | `agent` 单行 | 32 | 44 | 槽 32 + 上下内边距 8 = 40 → 取网格上不小于它的档 |
 * | `agent` 双行 | 32 | 48 | 名称 16 + 间距 4 + 描述 15 = 35 → 45 → 取 48 |
 * | `default` | 32 | 32 | 槽 32 + 内边距 8 − 4 = 36 → 取 32（槽本身就够撑住一行） |
 * | `settings` | 32 | 40 | 比 default 高一档，留出呼吸 |
 *
 * `default` 的行高比「槽 + 内边距」小是**有意的**：它的槽是 16 或 32 的**内容**，
 * 不是 44 那种带内边距的盒子。守卫验算的是「行高必须容得下槽本身」。
 */

import { SHELL_SIDEBAR_RAIL_WIDTH } from "../shellMotion.ts";
import { cn } from "../../lib/utils.ts";

/** 侧栏内容区左右内边距（`SidebarContent` 的 `px-2`）。 */
export const SIDEBAR_CONTENT_PADDING = 8;

/**
 * 行左右内边距的类名。
 *
 * 由数值生成而不是写 `px-2` / `px-1`：这两个数是行几何的一部分，
 * 写死成类名就与常量脱了钩（改常量不会改样式）。Tailwind 的间距刻度是 0.25rem，
 * 因此 `4 → px-1`、`8 → px-2`。
 */
function sidebar_row_padding_class_name(padding: number): string {
  return padding === 4 ? "px-1" : padding === 8 ? "px-2" : `px-[${padding / 4}rem]`;
}

/** 行自身左右内边距（行首是 32px 大槽的行：头像、单图标）。 */
export const SIDEBAR_ROW_PADDING = 8;

/** 行的纵向内边距。四个变体同值——密度差异由行高表达，不由内边距表达。 */
export const SIDEBAR_ROW_VERTICAL_PADDING = 4;

/**
 * 树行的左右内边距：**与纵向同值（4）**。
 *
 * 树行的行首是一个 24px 的箭头，它在 32px 高的行里上下各 4——左右也必须 4，
 * 否则箭头在小方框里看上去偏右（同一元素到四边的距离不等）。
 *
 * 判断依据不是“这一行在哪”，而是“行首那个东西多大”：
 * 32px 的头像需要 8px 才不显拥挤，24px 的箭头只需要 4px。
 */
export const SIDEBAR_TREE_ROW_PADDING = 4;

/** 行首槽宽：不放槽。 */
export const SIDEBAR_LEADING_NONE = 0;

/** 行首槽宽：单个 16px 图标。 */
export const SIDEBAR_LEADING_ICON = 16;

/** 行首槽宽：头像，或两个 16px 字形。 */
export const SIDEBAR_LEADING_AVATAR = 32;

/** 行首槽与文字之间的间距；不放槽时不计。 */
export const SIDEBAR_ROW_TEXT_GAP = 8;

/**
 * 树行里「箭头按钮 → 图标」的间距（4）。
 *
 * 比其它行的行内间距（`SIDEBAR_ROW_TEXT_GAP` = 8）窄一档，因为箭头是一个 **24px 的按钮**，
 * 里面的字形只有 14px——按钮左右各含 5px 内边距。真正看见的间距是 `5 + 间距`：
 * 写 8 就是 13px（比原来的 9px 宽出一半），写 4 才是原来的手感。
 *
 * 换句话说：**间距要从看得见的东西算，而不是从盒子算**。箭头盒自带内边距，
 * 不能当普通图标一样再给它一整份行内间距。
 */
export const SIDEBAR_TREE_CHEVRON_GAP = 4;

/**
 * 树行：缩进、箭头、图标。
 *
 * 树行不是第四种行——它就是 `default` 行（会话行、目录行同一套壳），
 * 只是行首多了一个**能单独点的箭头**、名字前多了一个图标。因此这里只定义这三件事：
 *
 * ```text
 * [▶ 24]─8─[📁 16]─4─名称         有图标（目录）
 * [   24]─8─[📄 16]─4─名称         无箭头但有图标（文件）：箭头位留同宽空位
 * [▶ 24]─8─名称                  无图标（Skill / Task 的树、Workspace 根）
 * ```
 *
 * 箭头 24 是**它的原始值**（`size-6`，可悬停、带焦点环）：一个小而完整的按钮，
 * 不是一个为了塞进某个槽而被压窄的图标。
 *
 * ## 没有图标就不留位
 *
 * **占位只在“同层里其它节点有图标”时才需要**（如目录与文件并列），
 * 而这个判断调用点自己最清楚：有图标就传 `icon`，没有就什么也不传。
 * 曾经有一个 `reserve_icon` 布尔值让调用点声明“给我留个空位”，结果三个真实调用点里
 * 两个把它当成了“默认要占位”——Skill / Task 的树整列因此多出 20px 空白。
 * 删掉它比留着安全：要占位就显式传一个占位节点，意图写在调用点上。
 */
export const SIDEBAR_TREE_INDENT = 12;

/** 树行的展开箭头按钮宽（`size-6`）。 */
export const SIDEBAR_TREE_CHEVRON = 24;

/** 树行的节点图标宽。 */
export const SIDEBAR_TREE_ICON = 16;

/** 节点图标与名字之间的间距（图标在名字同一个按钮里，不另立槽）。 */
export const SIDEBAR_TREE_ICON_GAP = 4;

/** 行盒起点相对侧栏左缘的距离：`40 + 8 = 48`。 */
export const SIDEBAR_ROW_ORIGIN = SHELL_SIDEBAR_RAIL_WIDTH + SIDEBAR_CONTENT_PADDING;

/** 行**内容盒**起点（无边框变体）：`48 + 8 = 56`。 */
export const SIDEBAR_ITEM_CONTENT_INSET = SIDEBAR_ROW_ORIGIN + SIDEBAR_ROW_PADDING;

/**
 * 行首槽：带底块的图标（Power 目录页）。
 *
 * 图标（16）住在一个 28px 的圆角底块里，**底块居中在标准的 32 槽内**。
 * 因此它不引入新的文字线（仍是 97），而底块到文字的实际间距是 `2 + 8 = 10`——
 * 正好是历史实现的 `gap-2.5`。
 *
 * 底块不是装饰：它把「一个能启用的能力包」（Power）与「一个有头像的身份」（Chat 主体）
 * 区分开。把它改成裸图标不会报错，只会让 Power 列表看起来像另一份联系人列表。
 */
export const sidebar_tile_class_name = "flex size-7 shrink-0 items-center justify-center rounded-item bg-surface-subtle text-muted-foreground [&_svg]:size-4";
/** 行变体。 */
export type SidebarItemVariant = "agent" | "default" | "settings";

/**
 * 行首槽宽。
 *
 * 只有 0 / 16 / 32 三档：28px 的图标底块是**槽里的内容**，不是槽本身
 * （它居中在 32 槽内，见 `sidebar_tile_class_name`）。
 */
export type SidebarLeadingWidth = typeof SIDEBAR_LEADING_NONE | typeof SIDEBAR_LEADING_ICON | typeof SIDEBAR_LEADING_AVATAR;

/**
 * 行首节点的形状。
 *
 * 三种形状回答同一个问题：“这是什么”，因此是一个枚举而不是三个布尔值——
 * 布尔值能表达出「既是头像又是底块」这种不存在的组合。
 *
 * | 形状 | 用在哪 |
 * | --- | --- |
 * | `icon` | 单个图标（设置条目） |
 * | `avatar` | 头像（Chat 主体）；槽位不声明图标尺寸，因为头像自己决定 |
 * | `tile` | 带圆角底块的图标（Power 条目）；底块把它与“一条记录”区分开 |
 */
export type SidebarLeadingShape = "icon" | "avatar" | "tile";

/**
 * 行内容起点。
 *
 * 由常量算出，不写死——它是三条文字线共同的基准，改任何一项都会同步改变它们，
 * `sidebar_row_contract.test.ts` 会盯着这条等式。
 */
export function sidebar_item_content_inset(): number {
  return SIDEBAR_ITEM_CONTENT_INSET;
}

/** 行内文字左缘相对侧栏左缘的距离。 */
export function sidebar_item_text_inset(variant: SidebarItemVariant, leading: SidebarLeadingWidth): number {
  return sidebar_item_content_inset() + leading + (leading === SIDEBAR_LEADING_NONE ? 0 : SIDEBAR_ROW_TEXT_GAP);
}

/**
 * 三条文字线，作为契约的验收值。
 *
 * 硬编码而不是从上面的函数读出来自比：从函数读的话，公式被改成什么都测不出来。
 */
export const SIDEBAR_TEXT_INSETS: Readonly<Record<SidebarItemVariant, number>> = {
  agent: 96,
  default: 56,
  settings: 80,
};

/**
 * 树形的文字线：`48 + 4 + 24 + 4 + 16 + 4 = 100`。
 *
 * 由行盒起点、紧凑行的左右内边距（4，与纵向同值）、箭头、箭头到图标的间距（4）、
 * 图标与图标到文字的间距（4）相加得到，再加 `12 × depth`。
 * 它不是一条新的对齐基准：树行就是 `default` 行，只是行首多了箭头与图标两件东西。
 */
export const SIDEBAR_TREE_TEXT_INSET = SIDEBAR_ROW_ORIGIN + SIDEBAR_TREE_ROW_PADDING + SIDEBAR_TREE_CHEVRON + SIDEBAR_TREE_CHEVRON_GAP + SIDEBAR_TREE_ICON + SIDEBAR_TREE_ICON_GAP;

/**
 * 行高。
 *
 * `default` 的行高比它的槽（32）只多出内边距能容纳的量：
 * 这里的槽指的是**内容**（图标/头像），不是「带内边距的盒子」——
 * 行自身的内边距已经在 `px-2 py-1` 里，不重复计算。
 */
export function sidebar_item_height_class_name(variant: SidebarItemVariant, multi_line = false): string {
  if (variant === "agent") return multi_line ? "min-h-12" : "min-h-11";
  return variant === "settings" ? "min-h-10" : "min-h-8";
}

/**
 * 常规行的排版骨架：行首是 32px 大槽的行（头像、单图标）。
 *
 * ## `w-full` 必须有
 *
 * 行的主体要么是 `<button>`，要么是 `flex` 的 `<div>`。**按钮不会像 div 那样填满父级**：
 * 它的 `width: auto` 是 shrink-to-fit，不写 `w-full` 就会缩到只剩内容宽——
 * 表现为“这一行的底色只有字那么长”。四个原始实现全都写了 `w-full`，就是这个原因。
 *
 * 代价是 `w-full` + `marginLeft` 会把行盒推出容器右缘（见 `sidebar_tree_indent_style`：
 * 缩进因此由**外层包一层**承担，而不是挂在行自己身上）。
 */
export const sidebar_row_layout_class_name = `group/item flex w-full items-center gap-2 py-1 text-left ${sidebar_row_padding_class_name(SIDEBAR_ROW_PADDING)}`;

/**
 * 树行的排版骨架：行内间距也窄一档（`gap-1` = 4）。
 *
 * 两个都要窄：左右 4（箭头到四边等距），行内间距 4（箭头按钮自带 5px 内边距，
 * 再给一整份 8 就会在箭头和图标之间留出一大段空白）。
 *
 * 树行是唯一用 4px 左右内边距的行：它的行首是一个 24px 的箭头，而 32px 高的行上下各 4，
 * 左右也必须 4，箭头到四边的距离才相等。
 */
export const sidebar_tree_row_layout_class_name = `group/item flex w-full items-center gap-1 py-1 text-left ${sidebar_row_padding_class_name(SIDEBAR_TREE_ROW_PADDING)}`;

/** 行的圆角：三个变体一律 `item`（列表项角色）。 */
const row_shape_class_name = "rounded-item";

/** 行的键盘焦点指示。侧栏所有可聚焦元素共用同一份，不各自写一套。 */
export const sidebar_row_focus_class_name = "outline-none focus-visible:ring-2 focus-visible:ring-ring/30";

/** 行的状态底色；选中与悬停互斥。 */
export function sidebar_row_interaction_class_name(active: boolean): string {
  return active ? "bg-interaction-selected hover:bg-interaction-active" : "hover:bg-interaction-hover";
}

/**
 * 行底：排版 + 高度 + 形状 + 底色。**不带键盘焦点环。**
 *
 * 侧栏的行有两种结构，这里的拆分就是为了它们：
 *
 * 1. **单一控件行**：整行就是一个 `<button>`（Power 条目、设置条目、树行的叶子）。
 *    用 `sidebar_item_class_name`，焦点环落在整行上。
 * 2. **复合行**：行底是 `<div>`，里面还有多个可聚焦元素（树行的箭头 + 标签 + 操作菜单）。
 *    底色必须在行底上，而焦点环必须落在**每一个**能聚焦的元素上——这是两件事，
 *    因此用 `sidebar_item_base_class_name`，环由行内各按钮自己声明。
 */
export function sidebar_item_base_class_name(options: {
  /** 行变体。 */
  variant: SidebarItemVariant;
  /** 是否是当前项；不传视为不是。 */
  active?: boolean;
  /** 是否有描述行；只影响 `agent` 变体的行高。 */
  multi_line?: boolean;
  /** 是否是树行：左右内边距 4（与纵向同值）+ 行内间距 4。 */
  tree?: boolean;
  /** 附加样式。 */
  class_name?: string;
}): string {
  return cn(
    options.tree ? sidebar_tree_row_layout_class_name : sidebar_row_layout_class_name,
    sidebar_item_height_class_name(options.variant, options.multi_line),
    row_shape_class_name,
    "transition-colors duration-150",
    sidebar_row_interaction_class_name(Boolean(options.active)),
    options.class_name,
  );
}

/** 单一控件行完整类名（整行可聚焦，焦点环落在行上）。 */
export function sidebar_item_class_name(options: {
  /** 行变体。 */
  variant: SidebarItemVariant;
  /** 是否是当前项；不传视为不是。 */
  active?: boolean;
  /** 是否有描述行；只影响 `agent` 变体的行高。 */
  multi_line?: boolean;
  /** 是否是树行；见 `sidebar_item_base_class_name`。 */
  tree?: boolean;
  /** 附加样式。 */
  class_name?: string;
}): string {
  return cn(sidebar_item_base_class_name(options), sidebar_row_focus_class_name);
}

/**
 * 行首槽：16 / 32 两档。
 *
 * 槽宽是**文字能否对齐的唯一依据**，因此它必须是元素（占位）而不是「图标自己的宽度」。
 * 没有图标的行不能放一个窄一点的槽，只能不放槽——放窄槽等于把文字往左挪，
 * 而放空槽等于把它往右挪，两者都会让同一列表里的文字错开。
 *
 * - 16：单个图标（设置条目）；
 * - 32：头像、带底块的图标（Power）、或「箭头 + 图标」（目录树）。
 */
export function sidebar_leading_class_name(width: Exclude<SidebarLeadingWidth, 0>): string {
  return width === SIDEBAR_LEADING_ICON
    ? "flex h-8 w-4 shrink-0 items-center justify-center text-muted-foreground [&_svg]:size-4"
    : "flex size-8 shrink-0 items-center justify-center text-muted-foreground [&_svg]:size-4";
}


/**
 * 头像槽：与 32 槽同宽，但**不声明图标尺寸**。
 *
 * 头像是「自己决定尺寸」的元素（`AgentAvatar` 的约定：尺寸由调用点给、形状由组件给），
 * 而 `[&_svg]:size-*` 是后代选择器，父级一旦声明就会盖掉子级自己的尺寸类
 * （优先级 0,2,0 对 0,1,0），于是「没配头像的 Agent 显示一个小图标」——
 * 同一个 Agent 配不配头像，左侧的视觉重量会差一倍。
 */
export const sidebar_avatar_slot_class_name = "flex size-8 shrink-0 items-center justify-center";

/**
 * 面板内容的左右内边距。
 *
 * 它是三条文字线的第一段（行盒起点 = Rail + 它），因此必须和行一起读：
 * 改这里而不同步行，整个侧栏的文字都会错开。`SidebarContent` 引用它。
 */
export const sidebar_content_class_name = "px-2";

/**
 * 面板标题与分组标签的左内边距。
 *
 * `56 − Rail 40 = 16`：标题直接住在面板里（不比行多一层内边距），
 * 所以它自己的内边距要把内容内边距与行内边距一起补上。写成字面量也能碰对，
 * 但那样改契约时它不会跟着动。
 */
export const sidebar_heading_class_name = "pl-4 pr-2";

/**
 * 树行箭头位（无箭头时）与图标位（无图标时）的占位。
 *
 * 两个占位都必须存在：没有箭头就不占位，叶子行的图标会比同级目录的图标左移一整个箭头宽；
 * 没有图标就不占位，根节点的名字会在图标列上左移。树的层级感就是靠这些列对齐读出来的。
 */
export const sidebar_tree_chevron_placeholder_class_name = "size-6 shrink-0";
export const sidebar_tree_icon_placeholder_class_name = "size-4 shrink-0";

/**
 * 树行行首的**静态图标**：叶子行自己带的一个图标（如「更多」的下箭头）。
 *
 * 它与展开箭头、归属头像**同格**（`size-6`），因此这类行的文字与同层其它树行落在同一条线上；
 * 字形取 `size-3.5`——与展开箭头里的字形同尺寸，两种行首在同一格里重量一致。
 *
 * 它**不是按钮**：整行已经是可点的标签按钮，再放一个按钮就成了嵌套。
 * 这也是它不复用 `sidebar_disclosure_class_name` 的原因——那个类自带 hover 与焦点环，
 * 属于「自己就是一个动作」的箭头；这里的图标不承担任何动作，只是给这一行一个可辨认的行首。
 */
export const sidebar_tree_leading_icon_class_name = "flex size-6 shrink-0 items-center justify-center text-muted-foreground [&_svg]:size-3.5";

/**
 * 树行的展开箭头：一个**完整的小按钮**（`size-6`、可悬停、带焦点环）。
 *
 * 尺寸与样式与重构前一致：它是行内唯一“自己就是一个动作”的元素，
 * 因此给定整格的命中区与悬停反馈，而不是被压成一条窄缝去迁就某个槽。
 *
 * 它比它所在的标签按钮**先**出现在行里，因此键盘 Tab 会先经过它——这与视觉顺序一致。
 * 点击不停冒泡因为它就是行内最早的动作，而宿主（`SidebarItem`）已经保证了行底不是按钮。
 */
export const sidebar_disclosure_class_name = "flex size-6 shrink-0 items-center justify-center rounded-control text-muted-foreground outline-none transition-colors hover:bg-interaction-hover hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/30 [&_svg]:size-3.5";

/** 行主标签：12px（侧栏的紧凑导航档，见 `desktop-type-scale-design.md` §4.1）。 */
export const sidebar_row_title_class_name = "min-w-0 truncate text-xs text-foreground";

/** 行描述：11px（元信息档）；**空描述不渲染这一行**。 */
export const sidebar_row_description_class_name = "min-w-0 truncate text-2xs text-muted-foreground";

/** 行的右侧动作列：宽度固定，因此各行的动作入口互相对齐。 */
export const sidebar_row_action_class_name = "flex size-6 shrink-0 items-center justify-center";

/**
 * 行外副文本（空态 / 加载态说明）的文字档位。
 *
 * 比行描述（`2xs`）再安静一档：它陈述的是“这里现在什么都没有”，
 * 而**不是**某个节点的元信息。用 `3xs`（10px）+ `subtle-foreground`（纯装饰档）——
 * 两者都取自既有令牌，也是它在重构前的实际观感（10px / 50% 弱化）。
 *
 * 它必须比行文字明显轻：副文本如果与行同重，空列表看起来就像有一条“内容”。
 */
export const sidebar_sub_text_class_name = "text-3xs leading-4 text-subtle-foreground";

/**
 * 树形行的左内边距：**整个行盒缩进**，不只是内容。
 *
 * 用 `marginLeft` 而不是 `paddingLeft`：padding 只把内容往右推，行盒本身仍从面板左缘开始——
 * 于是选中 / hover 的底色会从一个比节点更靠左的位置铺开，看起来像“错位的高亮”。
 * margin 把**行盒**（含底色、圆角、悬停区域）整体内缩，子节点才真的“住在父节点里面”。
 *
 * 缩进只改行盒的位置，不改行高，也不改行内内边距：
 * 行内仍是四边等距的 4，箭头才在它的小方框里居中。
 *
 * 返回内联样式而不是拼类名：缩进深度是数据，不是设计档位——
 * 写成 `ml-3`、`ml-6` 这类类名等于在类名里放一个变量，深度一大就无类名可用。
 */
export function sidebar_tree_indent_style(depth: number): { marginLeft: number } | undefined {
  return depth === 0 ? undefined : { marginLeft: depth * SIDEBAR_TREE_INDENT };
}

/**
 * 副文本（「正在读取」「空目录」「暂无执行记录」）的缩进：与**同级行的文字**对齐。
 *
 * 它不是行（没有行盒、没有箭头、不可点），因此要自己把两段加起来：
 * 层进（`depth × 12`）+ 行内到文字的距离。
 *
 * ## 为什么按“没有图标”那一档算
 *
 * 树行有两种文字线（有图标 100 / 无图标 80），副文本只能选一条。
 * 选“无图标”：因为需要副文本的场景（空列表、加载中）恰好都是**该层没有图标**的那类——
 * Skill / Task 的树整列没有图标，目录树的空目录说明也不对应某个具体节点。
 *
 * 早先这里写的是 `SIDEBAR_TREE_TEXT_INSET − SIDEBAR_ROW_ORIGIN`，即按“有图标”算，
 * 而图标从“必需”变成“可选”之后，它就把副文本推到了描述对象右边 20px。
 */
export function sidebar_text_indent_style(depth: number): { marginLeft: number } {
  return { marginLeft: depth * SIDEBAR_TREE_INDENT + SIDEBAR_TREE_ROW_PADDING + SIDEBAR_TREE_CHEVRON + SIDEBAR_TREE_CHEVRON_GAP };
}
