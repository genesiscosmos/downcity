/**
 * Sidebar 行的组件封装。**这是唯一的对外入口**，调用点不再拼 DOM、不再算行高。
 *
 * ## 一个组件，一条渲染路径
 *
 * 早先这里有两条分支（「整行一个按钮」与「行底 + 标签 + 操作位」），它们各自渲染一遍
 * 同样的东西。代价立刻显现：两条分支各错一次——
 *
 * - 一条丢了 `w-full`（按钮不填满父级，底色只有字那么长）；
 * - 一条把标题与描述摆成了并排（父级是 `flex items-center`）。
 *
 * 现在只有**一条**路径：行底永远是 `<div>`，可点的是里面的标签按钮，操作位在右端。
 * 差别只剩「有没有行内操作入口」——它决定要不要渲染那个操作位。
 *
 * 代价是多一层 DOM。这个代价是值得的：两条分支会分叉，而分叉的表现在界面上是
 * 「同一种行在两个地方长得不一样」，比一层 div 贵得多。
 *
 * ## 行首只有一种描述方式
 *
 * `leading` 交节点，`leading_shape` 说它是什么形状（图标 / 头像 / 带底块的图标）。
 * 早先是三个互斥的布尔值（`leadingWidth` / `leadingAvatar` / `leadingTile`），
 * 它们能表达出「既是头像又是底块」这种不存在的组合。
 */

import * as React from "react";
import { TbChevronRight } from "react-icons/tb";
import { cn } from "@/lib/utils";
import { SidebarLeading } from "./SidebarLeading";
import {
  SIDEBAR_LEADING_AVATAR,
  SIDEBAR_LEADING_ICON,
  sidebar_disclosure_class_name,
  sidebar_item_base_class_name,
  sidebar_row_action_class_name,
  sidebar_row_description_class_name,
  sidebar_row_focus_class_name,
  sidebar_row_title_class_name,
  sidebar_sub_text_class_name,
  sidebar_text_indent_style,
  sidebar_tree_chevron_placeholder_class_name,
  sidebar_tree_indent_style,
  type SidebarItemVariant,
  type SidebarLeadingShape,
} from "./sidebarRow";

/** 行变体；三档的取舍见 `docs/desktop-sidebar-design.md`。 */
export type { SidebarItemVariant };

/**
 * 行底的基调。
 *
 * - `default`：常规条目（会话、Power、目录），文字是 `foreground`；
 * - `secondary`：次要动作（新建对话、全部对话），文字是 `muted-foreground`，悬停转 `foreground`。
 */
type SidebarItemTone = "default" | "secondary";

/**
 * 行的文字区：标题 + 可选描述，**纵向两行**。
 *
 * 标题与描述是两个块级元素；若它们的父级是 `flex items-center`，它们就会变成
 * **并排的 flex 项**——看起来就是「两个内容挤在一行」。要两行，必须让这一层自己是一列。
 *
 * 描述与标题的间距 `mt-1`（4）不是随手取的：`agent` 双行的行高正是用它算的
 * （名称 16 + 4 + 描述 15 = 35 → 48），改这里必须同步行高。
 */
function SidebarRowTitleArea({ title, tag, description, tone = "default", titleClassName }: {
  /** 主标签。 */
  readonly title: React.ReactNode;
  /** 附属分类信息（如成员数）；悬停时才显形。 */
  readonly tag?: string;
  /** 第二行；不传则整个描述行不渲染。 */
  readonly description?: React.ReactNode;
  /** 基调。 */
  readonly tone?: SidebarItemTone;
  /** 标题附加样式。 */
  readonly titleClassName?: string;
}) {
  return <span className="min-w-0 flex-1">
    <span className="flex min-w-0 items-center gap-1.5">
      <span className={cn(sidebar_row_title_class_name, tone === "secondary" && "text-muted-foreground group-hover/item:text-foreground", tag ? "max-w-[55%] shrink" : "flex-1", titleClassName)}>{title}</span>
      {/* 元信息（如成员数）不抢主标签：悬停或键盘聚焦时才让位给它。 */}
      {tag ? <span className="max-w-36 shrink truncate rounded-chip bg-surface-subtle px-1.5 py-0.5 text-2xs leading-none text-muted-foreground opacity-0 transition-opacity duration-150 group-hover/item:opacity-100 group-focus-within/item:opacity-100">{tag}</span> : null}
    </span>
    {/* 空描述不渲染第二行：它不该在列表里变成一排「暂无描述」。 */}
    {description ? <span className={cn("mt-1 flex min-w-0 items-center", sidebar_row_description_class_name)}>{description}</span> : null}
  </span>;
}

/**
 * 行底：底色 + 高度 + 圆角，**不带键盘焦点环**。
 *
 * 行底是 `<div>`，可点的是里面的标签按钮——这样行内可以再放别的按钮（树形箭头、操作菜单、
 * 或一个可点的头像），而不会嵌套按钮。
 *
 * `SidebarItem` 用它；需要自建行的场合（如主体行的行首是个开关）也用它，
 * 这样两条路径的底色、行高、圆角仍然同源。
 */
export function SidebarRow({ variant, active = false, multiLine, tree = false, className, children }: {
  /** 行变体。 */
  readonly variant: SidebarItemVariant;
  /** 是否是当前项。 */
  readonly active?: boolean;
  /** 是否有第二行；只有 `agent` 变体的行高受它影响。 */
  readonly multiLine?: boolean;
  /** 是否是树行（左右内边距 4 + 行内间距 4）。 */
  readonly tree?: boolean;
  /** 附加样式。 */
  readonly className?: string;
  /** 行内容。 */
  readonly children: React.ReactNode;
}) {
  return <div className={cn(sidebar_item_base_class_name({ variant, active, multi_line: multiLine, tree }), className)}>{children}</div>;
}

/**
 * 行内可聚焦的标签区：标题 + 可选描述。
 *
 * 它自己的元素是 `<button>`，因此**标题与描述是纯文字**——描述不能是控件，
 * 否则读屏会把一段说明读成按钮名。
 *
 * `icon` 是名字前的图标（树行的节点图标），它**住在这个按钮里**：点文件夹图标也展开/打开，
 * 与重构前的行为一致——把图标做成不可点的装饰槽，会让行的左半部分看似可点而实际不是。
 */
export const SidebarRowLabel = React.forwardRef<HTMLButtonElement, SidebarRowLabelProps>(function SidebarRowLabel({ title, tag, icon, description, current = false, currentKind = "page", tone = "default", disabled = false, titleClassName, onSelect, onDoubleClick, ...rest }, ref) {
  return <button
    type="button"
    disabled={disabled}
    aria-current={current && !disabled ? currentKind : undefined}
    onClick={onSelect}
    onDoubleClick={onDoubleClick}
    title={typeof title === "string" ? title : undefined}
    className={cn("flex min-w-0 flex-1 items-center gap-1 self-stretch text-left", sidebar_row_focus_class_name)}
    {...rest}
    ref={ref}
  >
    {icon ? <>{icon}</> : null}
    <SidebarRowTitleArea title={title} tag={tag} description={description} tone={tone} titleClassName={titleClassName} />
  </button>;
});

/** 标题区参数；`SidebarRowLabel` 与 `SidebarItem` 共用。 */
interface SidebarRowLabelProps extends Omit<React.ComponentPropsWithoutRef<"button">, "title" | "children" | "className" | "onSelect" | "disabled" | "onDoubleClick"> {
  /** 主标签；字符串时会自动成为行的 `title` 属性。 */
  readonly title: React.ReactNode;
  /** 附属分类信息（如成员数）；悬停时才显形。 */
  readonly tag?: string;
  /** 名字前的图标。 */
  readonly icon?: React.ReactNode;
  /** 第二行；不传则整个描述行不渲染。 */
  readonly description?: React.ReactNode;
  /** 是否是当前项。 */
  readonly current?: boolean;
  /** `aria-current` 的取值；见 `SidebarItem`。 */
  readonly currentKind?: "page" | "true";
  /** 基调。 */
  readonly tone?: SidebarItemTone;
  /** 是否禁用。 */
  readonly disabled?: boolean;
  /** 标题附加样式。 */
  readonly titleClassName?: string;
  /**
   * 主操作。
   *
   * 带鼠标事件：调用方靠 `shiftKey` 区分「打开」与「多选」（见 Works 会话树），
   * 而这个修饰键只有原生事件里才有。
   */
  onSelect?(event: React.MouseEvent<HTMLButtonElement>): void;
  /** 双击；拿到原生事件。 */
  onDoubleClick?: React.MouseEventHandler<HTMLButtonElement>;
}

/**
 * 行右端的操作位：宽度固定（`size-6`），因此各行的操作入口互相对齐。
 */
export function SidebarRowAction({ children }: { /** 操作入口（通常是菜单触发器）。 */ readonly children: React.ReactNode }) {
  return <span className={sidebar_row_action_class_name}>{children}</span>;
}
/**
 * 行外副文本：「正在读取」「空目录」这类挂在行旁边的说明。
 *
 * 它不是行（没有行底、没有箭头、不可点），但必须与同级行的**文字**对齐——
 * 也就是要越过箭头那一列。字号与颜色取契约里的副文本档（比行描述再安静一档）。
 */
export function SidebarSubText({ indent = 0, className, children }: {
  /** 与同级行相同的缩进层数。 */
  readonly indent?: number;
  /** 附加样式。 */
  readonly className?: string;
  /** 说明内容。 */
  readonly children: React.ReactNode;
}) {
  return <div className={cn("flex items-center gap-1.5 py-1.5", sidebar_sub_text_class_name, className)} style={sidebar_text_indent_style(indent)}>{children}</div>;
}

/**
 * 树行参数：行首多了「一个能单独点的箭头」与「名字前的一个图标」的行。
 *
 * `icon` 不传就不留图标位——占位只在“同层里其它节点有图标”时才需要（目录与文件并列），
 * 而那种情况下调用点本来就该显式传一个占位节点。
 */
export interface SidebarTreeProps {
  /** 缩进层数；根节点不传或传 0。 */
  readonly indent?: number;
  /** 节点图标（文件夹 / 文件）。**不传就不留图标位**。 */
  readonly icon?: React.ReactNode;
  /**
   * 行首列的自定义节点，占的正是展开箭头那一格（`size-6`）。
   *
   * 树行的行首列只放**一样**东西：分支放展开箭头，叶子放自己的入口（如会话的归属头像）。
   * 两者占同一格，因此根节点与叶子的文字仍在同一条线上——这也正是它不叫 `leading`
   * 之外另开一个槽的理由：再多一个槽就会多推出一条文字线。
   *
   * 与 `disclosure` 互斥：同时给两者时以 `disclosure` 为准（展开比归属更要紧）。
   */
  readonly leading?: React.ReactNode;
  /**
   * 展开箭头。
   *
   * 传了它，行内就多一个可点元素——它必须能与行的标签分开点，因此不能住进标签按钮里。
   */
  readonly disclosure?: {
    /** 当前是否展开。 */
    readonly expanded: boolean;
    /** 可访问名称（「展开」「折叠」）；带上下文时由调用方拼好。 */
    readonly label: string;
    /** 切换展开。 */
    onToggle(): void;
  };
}

/** `SidebarItem` 参数。 */
interface SidebarItemProps extends Omit<React.ComponentPropsWithoutRef<"button">, "title" | "children" | "className" | "onSelect" | "disabled"> {
  /** 行变体；决定行高与文字线的档位。 */
  readonly variant: SidebarItemVariant;
  /** 主标签。 */
  readonly title: React.ReactNode;
  /** 是否是当前项。 */
  readonly active?: boolean;
  /** 是否禁用。 */
  readonly disabled?: boolean;
  /** 基调；见 `SidebarItemTone`。 */
  readonly tone?: SidebarItemTone;
  /** 行首节点（图标 / 头像 / 带底块的图标）。 */
  readonly leading?: React.ReactNode;
  /** 行首节点的形状；不传时按变体取默认档（`agent` 是头像位，其余是单图标）。 */
  readonly leading_shape?: SidebarLeadingShape;
  /** 树形行。 */
  readonly tree?: SidebarTreeProps;
  /** 第二行；不传则整个描述行不渲染，行高随之退回单档。 */
  readonly description?: React.ReactNode;
  /** 尾随元信息（计数、状态文字）。 */
  readonly trailing?: React.ReactNode;
  /** 行自己的操作入口（菜单触发器）；不传则右端不留位置。 */
  readonly menu?: React.ReactNode;
  /**
   * 菜单入口**左侧**的次要动作（通常是图标按钮）。
   *
   * 它排在菜单外面：越常用的动作越靠外，不必瞄内层。两个槽都在右侧固定列里，
   * 因此各行的动作入口仍然对得齐；只给一个时不白占位置。
   */
  readonly actions?: React.ReactNode;
  /** 附属分类信息（如成员数）；悬停时才显形。 */
  readonly tag?: string;
  /**
   * 主操作。
   *
   * 带鼠标事件：调用方靠 `shiftKey` 区分「打开」与「多选」（见 Works 会话树），
   * 而这个修饰键只有原生事件里才有。
   */
  onSelect?(event: React.MouseEvent<HTMLButtonElement>): void;
  /** 双击；拿到原生事件，目录树用它做展开/折叠。 */
  onDoubleClick?: React.MouseEventHandler<HTMLButtonElement>;
  /**
   * `aria-current` 的取值。
   *
   * 导航到另一个页面用 `page`（一级入口、设置分区），
   * 「当前所在的会话」用 `true`——它不是另一个页面，只是同一页里的一个位置。
   */
  readonly currentKind?: "page" | "true";
  /** 标题附加样式。 */
  readonly titleClassName?: string;
  /** 附加类名。 */
  readonly className?: string;
}

/**
 * 侧栏的一行。
 *
 * 三种变体（`agent` / `default` / `settings`）× 两种内容（有无行内菜单、有无树形箭头），
 * 都由这一个组件覆盖；调用方只描述内容，不描述几何。
 *
 * ## `ref` 与其余 button 属性必须真的落到标签按钮上
 *
 * 它们不是可选装饰：`<DropdownMenuTrigger asChild><SidebarItem /></DropdownMenuTrigger>`
 * 会把自己的 `onClick` 与 `ref` 合并到子元素上（Base UI 靠这个拿锚点、靠那个开合菜单）。
 * 早先这里把它们解构出来后没再用，菜单因此永远打不开——而界面上看不出任何异常。
 */
export const SidebarItem = React.forwardRef<HTMLButtonElement, SidebarItemProps>(function SidebarItem({
  variant,
  title,
  active = false,
  disabled = false,
  tone = "default",
  leading,
  leading_shape,
  tree,
  description,
  trailing,
  menu,
  actions,
  tag,
  onSelect,
  onDoubleClick,
  currentKind = "page",
  titleClassName,
  className,
  ...rest
}, ref) {
  // 只有 `agent` 变体的行高受第二行影响；`default` / `settings` 永远是单行。
  const multi_line = variant === "agent" && description != null && description !== "";

  /**
   * 行首：树行的箭头 / 普通行的节点。
   *
   * 树行没有箭头时占一个**同宽空位**——它与有箭头的兄弟节点并列，不占位就会错开一列。
   * 这个占位由组件自己做（它总是成立），不像图标位那样需要调用点声明。
   */
  const leading_node = tree
    ? (tree.disclosure
      ? <SidebarDisclosure expanded={tree.disclosure.expanded} label={tree.disclosure.label} onToggle={tree.disclosure.onToggle} disabled={disabled} />
      : tree.leading !== undefined
        ? tree.leading
        : <span aria-hidden="true" className={sidebar_tree_chevron_placeholder_class_name} />)
    : leading !== undefined
      ? <SidebarLeading shape={leading_shape ?? (variant === "agent" ? "avatar" : "icon")}>{leading}</SidebarLeading>
      : null;
  /** 树行名字前的图标；不传就没有（占位是调用点的事）。 */
  const inline_icon = tree?.icon ?? null;

  const title_area = <SidebarRowTitleArea title={title} tag={tag} description={description} tone={tone} titleClassName={titleClassName} />;

  // `title_area` 只在没有用 SidebarRowLabel 时保留（目前无用），删掉避免未使用变量。

  /**
   * 行的内容。三个位置职责固定：
   *
   * ```text
   * [行首]  标题 + 描述              [尾随] [操作位]
   * ```
   *
   * 行底是 `<div>`，可点的是里面那个标签按钮——**永远如此**，不因“有没有菜单”而变。
   * 这样两条历史分支的分叉（丢 `w-full`、标题排成一行）在结构上就不可能再发生。
   */
  const content = <>
    {leading_node}
    <SidebarRowLabel
      title={title}
      icon={inline_icon}
      description={description}
      tag={tag}
      current={active}
      currentKind={currentKind}
      tone={tone}
      disabled={disabled}
      titleClassName={titleClassName}
      onSelect={onSelect}
      onDoubleClick={onDoubleClick}
      // 原生 button 属性与 ref 转给标签按钮：它才是行里那个可聚焦元素，
      // 也是 `asChild` 合并 onClick / ref 的目标。
      {...rest}
      ref={ref}
    />
    {trailing != null ? <span className="shrink-0 text-2xs text-muted-foreground">{trailing}</span> : null}
    {actions !== undefined || menu !== undefined ? <span className="flex shrink-0 items-center gap-0.5">
      {actions}
      {menu !== undefined ? <SidebarRowAction>{menu}</SidebarRowAction> : null}
    </span> : null}
  </>;

  const row = <SidebarRow variant={variant} active={active} multiLine={multi_line} tree={tree !== undefined} className={cn(disabled && "opacity-50", className)}>{content}</SidebarRow>;
  /**
   * 树行的缩进包在外面。
   *
   * 缩进不能挂在行自己身上：行必须写 `w-full`（按钮不会像 div 那样填满父级），
   * 而 `w-full` + `marginLeft` 会把行盒推出容器右缘。包一层之后 `marginLeft` 落在
   * 块级包裹上，里面的行再 `w-full` 就正好落在右边。
   *
   * 没有缩进时不包（绝大多数行），不白多一层 DOM。
   */
  const indent_style = tree?.indent === undefined ? undefined : sidebar_tree_indent_style(tree.indent);
  return indent_style ? <div style={indent_style}>{row}</div> : row;
});

/**
 * 树行的展开箭头：一个完整的小按钮（`size-6`、可悬停、带焦点环）。
 *
 * 它比它所在的标签按钮先出现在行里，因此键盘 Tab 的顺序与视觉顺序一致。
 * 它带 `aria-expanded`——目录行的名字也能切换，但箭头是唯一暴露展开语义的元素。
 */
function SidebarDisclosure({ expanded, label, onToggle, disabled }: {
  /** 当前是否展开。 */
  readonly expanded: boolean;
  /** 可访问名称。 */
  readonly label: string;
  /** 切换展开。 */
  onToggle(): void;
  /** 是否禁用。 */
  readonly disabled?: boolean;
}) {
  return <button
    type="button"
    aria-label={label}
    aria-expanded={expanded}
    title={label}
    disabled={disabled}
    onClick={(event) => { event.stopPropagation(); onToggle(); }}
    className={sidebar_disclosure_class_name}
  ><TbChevronRight className={cn("transition-transform motion-reduce:transition-none", expanded && "rotate-90")} /></button>;
}
