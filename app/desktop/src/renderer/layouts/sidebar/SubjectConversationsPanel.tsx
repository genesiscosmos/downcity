/**
 * 主体行右侧按钮弹出的会话列表。
 *
 * ## 它是浮层，不是行内展开
 *
 * 会话列表**浮在侧栏之上**，不占列表的垂直空间：展开它不会把后面的主体推走，
 * 行列位置始终稳定。因此用 Popover（Portal + 碰撞定位），而不是把面板插进行里。
 *
 * 之前它曾是一个下拉**菜单**，问题不在「浮层」而在「菜单」：菜单项只有一种动作与一种外观，
 * 于是会话行只能是纯文字，也放不下自己的当前项高亮与操作入口。Popover 只提供
 * 「浮层 + 定位 + 展开语义」，里面渲染什么完全由这里决定——所以会话可以是**真的行**。
 *
 * Popover 自带触发器的 `aria-expanded` / `aria-controls` / `aria-haspopup`，
 * 并且 Popup 的默认 role 是 `dialog`——**它需要有名字**，调用方必须传 `aria-label`。
 *
 * ## 结构与归属
 *
 * 本组件是**卡片的下半**，上半是那一行；两者同属一个元素（见 subjectCard），
 * 因此这里不需要描边、底色、圆角，也不需要外壳：
 *
 * - 内边距由卡片提供（行与面板共用同一份，两段内容才对得齐）；
 * - 高度上限与滚动留在本层：滚动条在卡片内部，被卡片的 `overflow-hidden` 裁在圆角内
 *   （原因见 ui/menu-styles，守卫见 tests/popup_scroll_region.test.ts）。
 *
 * 高度上限是**固定值**（20rem），不再引用 `--available-height`：那个变量由浮动层的
 * Positioner 写入，而本面板现在长在普通文档流里（同一个卡片内），根本没有 Positioner，
 * 引用它等于永远走回退分支，不如直接写清楚。
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

import { TbPin, TbPinFilled, TbPlus } from "react-icons/tb";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import type { ChatRowStatus } from "@/features/chat/lib/chat_row_status";
import { cn } from "@/lib/utils";
import { use_translation } from "@/locales/i18n";

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
 * 会话行与新建行的共同骨架：同一套高度、圆角与交互态，差别只在内容与选中态。
 *
 * 提到模块级而不是写在组件里：一是每次渲染不必重建字符串，二是这份类名带了键盘焦点指示，
 * 需要能被 tests/design_token_drift.test.ts 的焦点名单识别到。
 */
export const subject_session_row_class_name = "flex min-h-7 w-full items-center gap-1.5 rounded-md px-2 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/30";

/** 主体会话列表属性。 */
export interface SubjectConversationsPanelProps {
  /** 该主体的会话，已按当前顺序排好。 */
  conversations: readonly SubjectConversation[];
  /** 新建对话；不提供时该项禁用（例如还没有可用 Workspace）。 */
  on_new_chat?(): void;
  /** 关闭列表；切换会话与新建之后都要关掉，否则它就会盖住刚打开的对话。 */
  close(): void;
  /** 是否保持展开（点外部不收起）。 */
  pinned: boolean;
  /** 切换保持展开。 */
  on_toggle_pinned(pinned: boolean): void;
}

/**
 * 卡片下半：主体行展开出来的会话列表。
 *
 * ## 布局：主操作在上，列表在下
 *
 * 「新建对话」是这一层的**首要动作**（进来通常就是为了开一个新的），因此固定在顶部，
 * 与列表分居两段；它不再随会话数量上下浮动。下面接会话列表。
 *
 * ## 固定按钮
 *
 * 默认行为是「点外部收起」——面板会盖住下面的行，不收起就得先想办法关掉它。
 * 只有确实要边看边操作时才需要它留着，所以固定做成**显式开关**而不是默认：
 * 顶部那一行的右侧，与“新建对话”同高。
 *
 * `aria-pressed` 表达开合，而不是把按钮名称改成“取消固定”：切换按钮的名称应保持稳定，
 * 状态交给 `aria-pressed`，读屏会读成“保持展开，切换按钮，已按下”。
 */
export function SubjectConversationsPanel({ conversations, on_new_chat, close, pinned, on_toggle_pinned }: SubjectConversationsPanelProps) {
  const translate = use_translation("navigation");
  // 内边距与滚动分成两层，这是滚动条能贴边的唯一办法：
  //
  // [滚动容器]  铺满卡片宽度、**不带内边距**——滚动条的横向位置由它自己的盒子决定，
  //             带内边距就会把滚动条从卡片右缘推到列表中间；
  //   └ [列表内边距]  p-1，与菜单同档
  //       └ [会话行]  自己再带 px-2 做文字内缩
  //
  // 即：**内边距要给内容，而不是给滚动容器**。给错了层，滚动条会跟着一起内缩。
  return <div className="max-h-80 overflow-y-auto overscroll-contain">
    <div className="p-1">
      {/* 顶部：新建对话（主操作）+ 保持展开（面板开关）。
          两个按钮同行，因此高度与下面的会话行一致，整列节奏不断。 */}
      <div className="flex items-center gap-0.5">
        <button
          type="button"
          disabled={!on_new_chat}
          onClick={() => { on_new_chat?.(); close(); }}
          title={translate("sidebar.new_chat")}
          className={cn(subject_session_row_class_name, "min-w-0 flex-1 text-muted-foreground enabled:hover:bg-interaction-hover enabled:hover:text-foreground disabled:opacity-50")}
        >
          <TbPlus className="size-3.5 shrink-0" aria-hidden="true" />
          <span className="min-w-0 flex-1 truncate text-xs">{translate("sidebar.new_chat")}</span>
        </button>
        <Button
          size="icon"
          actived={pinned}
          aria-pressed={pinned}
          title={translate("sidebar.keep_open")}
          onClick={() => on_toggle_pinned(!pinned)}
        >{pinned ? <TbPinFilled /> : <TbPin />}</Button>
      </div>
      {conversations.length === 0
        // 空态直接说结果；新建入口就在上面一行。
        ? <p className="px-2 py-1.5 text-[0.625rem] leading-4 text-muted-foreground">{translate("sidebar.no_sessions")}</p>
        : conversations.map((conversation) => (
          // `group/item` 是 RowMenuButton 显隐入口的钩子（见 chat_row_status）。
          <div
            key={conversation.key}
            className={cn(
              "group/item flex items-center gap-0.5 rounded-md transition-colors duration-150",
              conversation.active ? "bg-interaction-selected hover:bg-interaction-active" : "hover:bg-interaction-hover",
            )}
          >
            <button
              type="button"
              onClick={() => { conversation.select(); close(); }}
              // 「当前所在的会话」用 aria-current 表达；它不是导航到另一个页面，因此不用 page。
              aria-current={conversation.active ? "true" : undefined}
              title={conversation.title}
              className={cn(subject_session_row_class_name, "min-w-0 flex-1")}
            >
              <span className="min-w-0 flex-1 truncate text-xs text-foreground">{conversation.title}</span>
            </button>
            {/* 操作入口与主体行同宽同位。状态（未读 / 失败 / 正在回复）就画在这个入口上，
                因此不需要在标题旁边再放一个状态图标——那会让同一件事在一行里出现两次。 */}
            {conversation.menu ? <span className="flex size-6 shrink-0 items-center justify-center">{conversation.menu}</span> : null}
          </div>
        ))
      }
    </div>
  </div>;
}
