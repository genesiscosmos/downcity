/**
 * 主体行展开出来的会话列表（卡片下半）。
 *
 * ## 它是卡片的下半，不是浮层
 *
 * 会话列表**不是**浮动层：卡片就长在列表里（浮动态绝对定位、嵌入态留在流里，见 subjectCard），
 * 因此这里不需要描边、底色、圆角，也不需要外壳。
 *
 * 高度上限与滚动留在本层；左右内边距**不给**（见下）。
 *
 * 早期它曾是一个下拉**菜单**，问题不在「浮层」而在「菜单」：菜单项只有一种动作与一种外观，
 * 于是会话行只能是纯文字，也放不下自己的当前项高亮与操作入口。现在会话是**真的行**。
 *
 * ## 三种行都是 `default`，而且都没有行首槽
 *
 * ```text
 * [新建对话                    ]  ← 无槽，文字在 56
 * [会话标题                    ]
 * [全部 N 个对话               ]
 * ```
 *
 * 「新建对话」「会话」「全部对话」原先各带一个 14px 图标，会话行没有——于是同一张卡片里
 * 标题落在两个不同的横坐标上，而它们看上去本该是一列。**图标全部去掉**才是这一段的正解：
 * 三者都是「对整列做点什么」或「一条会话」，位置与文案已经说清了身份，
 * 图标只是在给同一列制造第二条文字线。
 *
 * 文字线因此是卡片外的 56（卡片内 57，差的是卡片那 1px 描边，见 `sidebarRow.ts`）——
 * 与目录树、设置、Power 条目各自在自己的容器里保持一条线。
 *
 * ## 两层结构：表面负责裁剪，滚动区负责滚动
 *
 * ```text
 * [卡片]        rounded-surface + border + overflow-hidden  ← 只裁剪
 *   └ [滚动容器] max-h-80 + overflow-y-auto（仅浮动）        ← 只滚动，无内边距
 *       └ [行]   px-2                                       ← 文字内缩在这里
 * ```
 *
 * 即：**内边距要给内容，不要给滚动容器**。高度上限只能写在滚动层（见 ui/menu-styles，
 * 守卫见 tests/popup_scroll_region.test.ts）。
 *
 * ## 条数上限：嵌入态只直接列出 4 条
 *
 * 上限由调用方通过 `max_visible` 传入，只有嵌入态会传——理由是嵌入长期占位，而浮动点外部就收。
 * 超出的部分不隐藏在滚动条后面，而是收进一条「全部对话」入口：滚动条只会告诉用户
 * 「下面还有」，而一个菜单能把全部会话一次摆平，且不额外占高度。
 *
 * ## 会话行的两个入口
 *
 * 与主体行同构：左侧可点区域负责「切换过去」，右侧是这一条自己的操作菜单。
 * 菜单元素由调用方构造（`conversation.menu`），本组件只负责给它一个位置——
 * 这样面板不需要认识 Session 目录，也不需要知道删除要弹什么确认框。
 *
 * 菜单入口会随行 hover / 键盘聚焦显隐（未读、失败这类状态则常显），
 * 由 `RowMenuButton` 自己根据状态决定；行上的 `group/item` 就是它显隐的钩子。
 */

import { TbPin, TbPinFilled } from "react-icons/tb";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { ChatStatusIcon } from "@/components/ChatStatusIcon";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown";
import type { ChatRowStatus } from "@/features/chat/lib/chat_row_status";
import { use_translation } from "@/locales/i18n";
import { SidebarItem } from "./SidebarItem";
import { split_visible_sessions, subject_panel_padding_class_name } from "./subjectCard";

/**
 * 面板里的一条会话。
 *
 * 已解析为展示所需的最小信息，不含任何导航逻辑——这样面板本身不需要认识 Session 目录。
 */
export interface SubjectConversation {
  /** 稳定标识，用作 React key 与当前项判定。 */
  key: string;
  /** 会话标题；空标题由调用方给出兜底文案。 */
  title: string;
  /** 是否为当前打开的会话。 */
  active: boolean;
  /** 这一条自己的行状态；决定操作入口的图标与显隐。 */
  status: ChatRowStatus;
  /** 切换到这条会话。 */
  select(): void;
  /** 这一条的操作菜单；不提供时右侧不留位置。 */
  menu?: ReactNode;
}

/**
 * 无会话时的共享空列表。
 *
 * 必须共用同一个引用：折叠态的所有行都拿它当 `conversations`，每次渲染新建一个 `[]`
 * 会让行组件的 memo 全部失效（浅比较认为 props 每次都变了）。
 */
export const empty_conversations: readonly SubjectConversation[] = [];

/**
 * 没有任何展开面板时的共享空投影表。
 *
 * 与 `empty_conversations` 同理：投影结果是一张 `key → 会话列表` 的表，
 * 没有展开时就不能每帧新建一张空 Map（行的 memo 靠引用比较）。
 */
export const empty_conversations_by_subject: ReadonlyMap<string, readonly SubjectConversation[]> = new Map();

/**
 * 「全部对话」菜单的宽度：比侧栏宽一档，且封在能完整读下一个标题的范围内。
 *
 * ```text
 * min-w-80  320px  ← 比侧栏默认 280 宽一档，短标题也能一眼扫完
 * max-w-md  448px  ← 长标题再长也封住，菜单不会横成一条难以阅读的长带
 * ```
 *
 * 中间那段是**内容自等**：标题短就停在 320，长就长到 448 再截断。固定写死一个宽度
 * 会让短会话名白白浪费横向空间，而那个空间本来可以用来读长名字。
 *
 * 为什么不用 `--available-width`：窗口最小宽度是 760，此时侧栏早已自动折叠
 * （见 shellResponsive），正文区仍有 528px 以上，448 在任何可达尺寸下都放得下。
 * 用一个在部分上下文里未定义的 CSS 变量反而会静默失效（`min()` 里出现未定义变量会让
 * 整条声明被丢弃），不如直接写确定值。
 */
export const all_sessions_menu_class_name = "min-w-80 max-w-md";

/**
 * 浮动态的滚动容器：高度上限 + 自己的滚动 + **不把滚动传给侧栏**。
 *
 * `overscroll-contain` 在这种形态下是必需的：浮动卡片盖在后续行之上，
 * 如果滚到头之后接着滚侧栏，动的就是被卡片盖住、用户看不见的那些行——
 * 屏幕上一片静止、松手后才发现自己在别处。宁可滚到头就停住。
 *
 * 嵌入态**不用它，也没有滚动容器**（见下面的 `scrolls_itself`）。
 */
export const subject_panel_scroll_class_name = "max-h-80 overflow-y-auto overscroll-contain";

/** 主体会话列表属性。 */
export interface SubjectConversationsPanelProps {
  /** 该主体的会话，已按当前顺序排好。 */
  conversations: readonly SubjectConversation[];
  /** 新建对话；不提供时该项禁用（例如还没有可用 Workspace）。 */
  on_new_chat?(): void;
  /**
   * 选中一条会话 / 新建之后的收尾。
   *
   * **不传就是“不用收”**（面板里写 `close?.()`）：嵌入态的卡片不盖住任何东西，
   * 没有“用完就得让位”这回事。
   */
  close?(): void;
  /** 是否保持展开（点外部不收起）。 */
  pinned: boolean;
  /** 切换保持展开。 */
  on_toggle_pinned(pinned: boolean): void;
  /**
   * 最多直接列出多少条会话；超出的收进「全部对话」菜单。
   *
   * 不传 = 不限制。只有嵌入态会传（见 `docked_visible_session_count`）：
   * 嵌入长期占位，条数必须有上限；浮动点外部就收，滚动已经够用。
   */
  max_visible?: number;
}

/**
 * 卡片下半：主体行展开出来的会话列表。
 *
 * ## 布局：主操作在上，列表在下
 *
 * 「新建对话」是这一层的**首要动作**（进来通常就是为了开一个新的），因此固定在顶部，
 * 与列表分居两段；它不再随会话数量上下浮动。下面接会话列表。
 *
 * ## 固定开关
 *
 * 浮动会盖住它下面的行，所以它有「点外部收起」这个默认行为；嵌入没有这回事，
 * 因此固定开关在嵌入态是「已经按下」的状态，按它只是回到浮动。
 * 开关本身只上报目标状态，不判断当前处在哪个态——那是调用方的事。
 *
 * ## 滚动：嵌入态**不自己滚**
 *
 * ```text
 * 浮动  max-h-80 + overflow-y-auto + overscroll-contain   ← 自己是浮层，自带滚动
 * 嵌入  不包滚动容器，卡片直接长高                        ← 交给侧栏一起滚
 * ```
 *
 * 这里曾经不分形态、两边都上 `max-h-80 + overflow-y-auto + overscroll-contain`，
 * 结果是：**鼠标停在嵌入的面板上滚不动整个侧栏**。原因是嵌套滚动容器的正常行为——
 * 光标下的元素既然是滚动容器，滚轮就先归它；它的内容装得下（嵌入态最多 4 条会话 + 2 行，
 * 远不到 320px）所以一像素都不动，而 `overscroll-contain` 又明确禁止把滚动传给侧栏，
 * 于是整个手势被吃掉。用户看到的正是“固定在列表里的面板把侧栏的滚动卡住了”。
 *
 * 修法不是去掉 `overscroll-contain`，而是**嵌入态不要那个滚动容器**：嵌入的卡片就在列表流里，
 * 与它后面的主体是同一份内容，本来就该一起滚——两个滚动容器嵌套在这里没有任何好处，
 * 只会制造一个“滚不动”的死区。
 *
 * 高度不会因此失控：条数上限（`docked_visible_session_count`）已经把嵌入态封在
 * 新建行 + 4 条会话 + 「全部」行，约 192px；那个上限现在承担两件事——
 * 一是别把后面主体推出屏幕，二是让“不自己滚”成立。两者是同一个约束。
 *
 * 判定就落在 `max_visible` 上，因为它的含义恰好是“调用方已经把我的高度封顶了”：
 * 被封顶就不需要自己滚；没人封顶（浮动态）才要。
 */
export function SubjectConversationsPanel({ conversations, on_new_chat, close, pinned, on_toggle_pinned, max_visible }: SubjectConversationsPanelProps) {
  const translate = use_translation("navigation");
  // 超出的部分不靠滚动藏起来，而是走进「全部对话」菜单——滚动条只说“下面还有”，
  // 而菜单能把全部会话一次摆平，还不额外占高度。缝界由纯函数决定（见 subjectCard）。
  const { visible: visible_conversations, has_more } = split_visible_sessions(conversations, max_visible);
  const scrolls_itself = max_visible === undefined;

  // 内边距与滚动分成两层，这是滚动条能贴边的唯一办法（见文件头）。
  // 嵌入态不包外层：滚动归侧栏。
  const content = <div className={subject_panel_padding_class_name}>
      {/* 顶部：新建对话（主操作）+ 保持展开（面板开关）。
          两者同行，因此高度与下面的会话行一致，整列节奏不断。
          容器右侧只留行内边距那一档（4）：固定开关与下面各行的操作位因此落在同一列上。 */}
      <div className="flex items-center gap-2 pr-1">
        <SidebarItem
          variant="default"
          // 卡片里的行：卡片已经抱住了行，左右内边距收窄到与纵向同值。
          compact
          tone="secondary"
          className="min-w-0 flex-1"
          disabled={!on_new_chat}
          title={translate("sidebar.new_chat")}
          onSelect={() => { on_new_chat?.(); close?.(); }}
        />
        <Button
          size="icon"
          actived={pinned}
          aria-pressed={pinned}
          title={translate("sidebar.keep_open")}
          onClick={() => on_toggle_pinned(!pinned)}
        >{pinned ? <TbPinFilled /> : <TbPin />}</Button>
      </div>
      {conversations.length === 0
        // 空态直接说结果，并且与上面的标题同列；新建入口就在上一行。
        ? <p className="px-1 py-1.5 text-2xs leading-4 text-muted-foreground">{translate("sidebar.no_sessions")}</p>
        : <>
          {visible_conversations.map((conversation) => (
            // 行带自己的操作菜单，因此 `SidebarItem` 自动采用「行底 + 标签按钮 + 操作位」；
            // 状态（未读 / 失败 / 正在回复）就画在那个入口上，所以标题旁边不再放第二个图标。
            <SidebarItem
              key={conversation.key}
              variant="default"
              // 卡片里的行：见 `SIDEBAR_COMPACT_ROW_PADDING`。
              compact
              // 「当前所在的会话」不是导航到另一个页面，因此用 true 而不是 page。
              currentKind="true"
              active={conversation.active}
              title={conversation.title}
              onSelect={() => { conversation.select(); close?.(); }}
              menu={conversation.menu}
            />
          ))}
          {/* 超出的部分：一条与「新建对话」同构的行，点开是全部会话。
              它自己也占一行、也在同一个列表里，因此不是“列表之外的补充入口”。 */}
          {has_more ? <MoreSessionsRow conversations={conversations} close={close} /> : null}
        </>}
  </div>;

  return scrolls_itself ? <div className={subject_panel_scroll_class_name}>{content}</div> : content;
}

/**
 * 「全部对话」入口：列出被上限挡住的那些，同时把已列出的也一并给出。
 *
 * 菜单里放**全部**会话而不是只放被挡住的那几条：用户点它的心态是「我要找的那条不在上面」，
 * 此时还要在“上面 4 条”和“菜单里 8 条”之间做除法，等于把上限这件事泄漏给了用户。
 * 全给一遍，上限就只是“上面能先看到几条”，不再是一条需要记住的规则。
 *
 * ## 为什么向右展开而不是向下
 *
 * 这条入口列的是**名字**，而侧栏最宽也只能拖到 400（默认 280，见 `SHELL_SIDEBAR_*_WIDTH`）：
 * 往下弹时菜单跟侧栏一样窄，每条标题都被截断，长的会话名一眼分不出谁是谁——
 * 而这正是用户点它的原因。向右飞去就落在正文区，宽度随便用，名字能完整读完。
 *
 * 这也跟侧栏既有的右侧飞出保持一致：Rail 的图标 tooltip 就是 `side="right"`。
 * 上下方向的菜单仍然留给会话行右侧那三个动作（重命名 / 归档 / 删除）——它们只有三项，
 * 贴在行下面离鼠标最近；把短菜单也飞出去反而要跨过侧栏去追它。
 *
 * 菜单是 Portal 出去的，因此不会被卡片的 `overflow-hidden` 剪掉。
 * 条数上限与滚动由 `DropdownMenuContent` 的共享表面负责（见 ui/menu-styles），
 * 因此再长也不会漫出窗口，也不会让滚动条戳出圆角。
 */
function MoreSessionsRow({ conversations, close }: {
  /** 该主体的**全部**会话。 */
  conversations: readonly SubjectConversation[];
  /** 与普通会话行同一份收尾逻辑；嵌入态不传，菜单选中后不关面板。 */
  close?(): void;
}) {
  const translate = use_translation("navigation");
  return <DropdownMenu>
    <DropdownMenuTrigger asChild>
      {/* 与「新建对话」同一套骨架与文案档位：两者都是“对整列做点什么”，不是某一条会话。
          触发器会把 onClick 与 ref 合并到这个元素上，因此它必须是一个真按钮。 */}
      <SidebarItem
        variant="default"
        tone="secondary"
        title={translate("sidebar.all_sessions", { count: conversations.length })}
      />
    </DropdownMenuTrigger>
    {/* 向右展开，与被点的那一行顶端对齐，并留出与 Rail tooltip 同档的间距（8）。
        菜单比侧栏宽得多，因此对齐方向是“从行向右延伸”，没有右边缘对齐这回事。 */}
    <DropdownMenuContent side="right" align="start" sideOffset={8} className={all_sessions_menu_class_name}>
      {/* 菜单项不重复提供逐条操作（重命名 / 归档 / 删除）：菜单里嵌菜单是另一套导航，
          键盘用户会在两层方向之间迷路。要动某条会话，回到上面那几条行走右侧入口。 */}
      {conversations.map((conversation) => (
        <DropdownMenuItem
          key={conversation.key}
          // 当前会话在这里也要认得出：上面那 4 条之外，这里同样能一眼看到“我在哪”。
          is_selected={conversation.active}
          onClick={() => { conversation.select(); close?.(); }}
        >
          <span className="min-w-0 flex-1 truncate">{conversation.title}</span>
          {/* 状态是**展示**，不是入口：菜单项里再放一个按钮会让菜单的键盘导航多出一层。
              idle 传 null，因此没有状态的条目不会多留一段空白。 */}
          <ChatStatusIcon status={conversation.status} fallback={null} />
        </DropdownMenuItem>
      ))}
    </DropdownMenuContent>
  </DropdownMenu>;
}
