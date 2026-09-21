/**
 * Desktop 壳层右侧的 BayBar。
 *
 * ## 结构
 *
 * ```
 * DesktopShell
 * └── 一行：Sidebar + 正文区
 *     ├── Sidebar（贴窗口左缘、整窗高）
 *     └── 正文区（一行：main + BayBar）
 *         ├── main（p-1）
 *         │   └── MainView 卡片（圆角 + 边框 + bg-background）
 *         └── BayBar（贴窗口右缘、整窗高）
 *             └── 面板：顶栏一行标签页 + 内容区
 *
 * 窗口右上角另有一个固定的折叠按钮（ShellBayBarControl），与左侧 Sidebar 控件镜像。
 *
 * 正文区为什么单独一层：它是本面板量宽度的基准，而宽度上限 = 本层宽度 − 正文保留量。
 * 与 Sidebar 同级时会多量进一个 Sidebar，用户能把右栏拖到把正文压到下限以下。
 *
 * ## 与卡片留白的关系
 *
 * main 有 p-1：卡片是内缩的圆角卡，面板却是贴窗口边缘的整窗高列。两者边缘因此相差
 * SHELL_MAIN_VIEW_OFFSET，而用户看到的边界是卡片边缘（浅色主题下就是那条白边）。
 * 缩放把手要跨过这段留白、外缘与卡片边缘重合（见 PanelResizeHandle）；
 * 留白本身不承担任何视觉分隔作用（面板与窗口底色相同）。
 * ```
 *
 * ## 与 Sidebar 完全同构
 *
 * | | Sidebar | BayBar |
 * |---|---|---|
 * | 折叠状态 | Shell 里的 `sidebar_collapsed` | store 里的 `open` |
 * | 折叠按钮 | ShellSidebarControl（fixed） | ShellBayBarControl（fixed） |
 * | 收起后 | 宽度动画到 0，卡片顶栏让出空间 | 同 |
 * | 展开后 | 顶栏 + 内容 | 顶栏（标签行）+ 内容 |
 *
 * 差别只有一处：BayBar 的顶栏是标签行，而 Sidebar 的顶栏是模式标题。
 *
 * ## 三条边界规则
 *
 * 1. **折叠只看 `open`。** 不用「有没有标签页」反推——展开着但一个标签页都没有
 *    是合法状态（空白标签页）。曾经用 `active === null` 当作「已收起」，
 *    结果空白标签页状态下按钮只能展开、永远收不起来。
 * 2. **面板与按钮始终渲染。** 面板是壳层的一列（与 Sidebar 同性质），
 *    「里面有没有东西」不影响它存在；没有任何早期 return。
 * 3. **Provider 必须包住正文与面板两者。** 正文里的入口与面板共用同一份 context。
 */

import { createContext, useContext, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from "react";
import { motion } from "framer-motion";
import { TbLayoutSidebarRight, TbX } from "react-icons/tb";
import { use_horizontal_resize } from "@/hooks/use_horizontal_resize";
import { use_media_query } from "@/hooks/use_media_query";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { ShellBayBarControl } from "./ShellBayBarControl";
import { PanelResizeHandle } from "./PanelResizeHandle";
import { use_store_selector } from "@/lib/store";
import { cn } from "@/lib/utils";
import { use_translation } from "@/locales/i18n";
import { empty_baybar_store, type BayBarStore } from "./baybarStore";
import { BAYBAR_AUTO_COLLAPSE_WIDTH, resolve_baybar_max_width, resolve_shell_auto_collapse } from "./shellResponsive";
import type { BayBarSection, BayBarTab } from "./baybarPanelState";
import { resolve_section } from "./baybarPanelState";
import {
  SHELL_BAYBAR_DEFAULT_WIDTH,
  SHELL_BAYBAR_MIN_WIDTH,
  SHELL_HEADER_HEIGHT_CSS,
  SHELL_PANEL_TRANSITION,
} from "./shellMotion";

export type { BayBarSection, BayBarTab, BayBarTranslate } from "./baybarPanelState";
export { baybar_tab_id } from "./baybarPanelState";

/** 兜底的空 store：不在壳内渲染时（单测、独立组件）使用。 */
const noop_open_tab = () => undefined;
const noop_close_tab = () => undefined;
const noop_set_tab_label = () => undefined;

/**
 * 壳层提供的 store 句柄。
 *
 * 值是稳定引用（store 句柄 + 动作），因此 Provider 自身不会因面板状态变化而重渲染；
 * 需要响应状态的是各自的读取方，它们按最小切片订阅。
 */
const BayBarContext = createContext<BayBarStore | undefined>(undefined);

/** 向正文与面板提供 store 句柄；由 DesktopShell 挂在正文区之上。 */
export function BayBarProvider({ value, children }: {
  /** 面板 store 与动作。 */
  value: BayBarStore;
  /** 正文与面板。 */
  children: ReactNode;
}) {
  return <BayBarContext.Provider value={value}>{children}</BayBarContext.Provider>;
}

/**
 * 打开一个标签页。
 *
 * 正文里的入口用它把「某个对象的某个面板」打开到右侧，避免一路透传回调。
 * 标签页由调用方在点击处构造（见各 feature 的 `*_tab()`），
 * 面板因此不认识任何业务内容。
 */
export function use_baybar_open(): (tab: BayBarTab, section_id?: string) => void {
  // 直接返回 store 上那个稳定引用，不要包一层箭头函数：
  // 调用方会把它放进 useCallback 依赖，每次渲染新建函数会让下游 memo 全部失效。
  return useContext(BayBarContext)?.open_tab ?? noop_open_tab;
}

/**
 * 某个标签页是否正被展示（面板展开且它就是当前页）。
 *
 * 正文里的入口需要知道自己对应的面板是否已经接管：例如输入区展开后，
 * 正文里那一份必须让位——两个编辑器同时持有同一份草稿会互相覆盖。
 * 这里读的是**派生状态**（open + active_id），不额外维护一份“谁展开了”的标记：
 * 两份状态一旦并存就会不同步，而标签页本身就是唯一的真相。
 */
export function use_baybar_tab_active(tab_id: string): boolean {
  const store = useContext(BayBarContext)?.store ?? empty_baybar_store;
  return use_store_selector(store, (state) => state.open && state.active_id === tab_id);
}

/** 关闭一个标签页；不在壳内时为空操作。 */
export function use_baybar_close_tab(): (tab_id: string) => void {
  return useContext(BayBarContext)?.close_tab ?? noop_close_tab;
}

/** 刷新一个已打开标签页的标题；不在壳内时为空操作。 */
export function use_baybar_set_tab_label(): (tab_id: string, label: string) => void {
  return useContext(BayBarContext)?.set_tab_label ?? noop_set_tab_label;
}

/**
 * MainView：正文卡片。
 *
 * 只是一张卡：不接收标签页、不提供打开面板的动作，也不知道面板里显示什么。
 *
 * 它不写 min-width：正文下限由外层 main 承担（见 SHELL_MAIN_VIEW_MIN_REGION_CSS）。
 * 卡片是 flex 项，自己写 min-width 只能让它溢出、撑不开父层，下限要落在行内元素上。
 */
export function MainView({ children }: { /** 页面 Header 与 Body。 */ children: ReactNode }) {
  return <div
    className="relative flex h-full min-h-0 flex-1 flex-col overflow-hidden rounded-surface border border-border-subtle bg-background"
  >{children}</div>;
}

/** 壳层右侧的一列：宽度可拖动的面板 + 窗口上固定的折叠按钮。两者始终存在。 */
export function BayBar() {
  const baybar = useContext(BayBarContext);
  const store = baybar?.store ?? empty_baybar_store;
  const open = use_store_selector(store, (state) => state.open);
  const tabs = use_store_selector(store, (state) => state.tabs);
  const active_id = use_store_selector(store, (state) => state.active_id);
  const section_by_tab = use_store_selector(store, (state) => state.section_by_tab);
  const toggle = baybar?.toggle;

  // 收起时没有「当前标签页」可言；展开时找不到就是空白标签页。
  const active = open ? tabs.find((item) => item.id === active_id) ?? null : null;
  const section_id = active ? section_by_tab[active.id] ?? null : null;

  // 可用宽度：量本组件的**父层**，也就是 Shell 里那个正文区（main + BayBar）。
  //
  // 必须挂在这一层：量到面板自己，上限就会跟着当前宽度走，拖拽会自己把边界往前推；
  // 量到含 Sidebar 的那一行，上限又会多出一个 Sidebar 的宽度。
  // 这一层的宽度只由窗口与 Sidebar 决定，是唯一稳定的基准。
  //
  // 正文下限直接读 main 的 computed min-width，而不是自己用设计值 × 缩放算：
  // 这样 JS 与 CSS 只有一份事实，缩放后不可能各算各的。
  const root_ref = useRef<HTMLDivElement>(null);
  const [range, set_range] = useState({ available: 0, floor: 0 });
  useLayoutEffect(() => {
    const region = root_ref.current?.parentElement;
    const content = region?.querySelector<HTMLElement>("main");
    if (!region || !content) return;
    const measure = () => {
      const next = {
        available: Math.round(region.getBoundingClientRect().width),
        floor: Math.round(Number.parseFloat(getComputedStyle(content).minWidth)),
      };
      // 返回同一个引用让 React 跳过无意义的重渲染。
      set_range((current) => current.available === next.available && current.floor === next.floor ? current : next);
    };
    // 在布局阶段同步量一次：拖拽上限依赖它，等普通 effect 就已经晚了一帧。
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(region);
    return () => observer.disconnect();
  }, []);

  // 窗口窄到正文会被挤没时自动收起。与左侧 Sidebar 共用同一套决策：
  // 只响应「窗口跨越断点」，用户手动展开不会被覆盖。
  const open_ref = useRef(open);
  open_ref.current = open;
  const narrow_window = use_media_query(`(max-width: ${BAYBAR_AUTO_COLLAPSE_WIDTH}px)`);
  const auto_collapsed_ref = useRef(false);
  const collapse = baybar?.collapse;
  const expand = baybar?.expand;
  useEffect(() => {
    if (!collapse || !expand) return;
    const next = resolve_shell_auto_collapse({
      narrow: narrow_window,
      collapsed: !open_ref.current,
      auto_collapsed: auto_collapsed_ref.current,
    });
    auto_collapsed_ref.current = next.auto_collapsed;
    if (next.collapsed) collapse();
    else expand();
    // 依赖里刻意不放 open：本效果只响应「窗口跨越断点」。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [narrow_window]);

  return <>
    {/* 缩放把手以本列（外层带 root_ref 的那一层）为定位基准，因此它必须保持 relative。 */}
    <div ref={root_ref} className="relative flex h-full min-h-0 shrink-0">
      <BayBarPanel open={open} active={active} active_id={active_id} tabs={tabs} section_id={section_id} range={range} />
    </div>
    <ShellBayBarControl collapsed={!open} toggle_baybar={() => toggle?.()} />
  </>;
}

/**
 * 空白标签页的提示。
 *
 * 面板展开着但没有任何标签页时，右边一整列都是空的（约 400px 宽），
 * 什么都不放会让人以为加载失败。这里给的是**功能说明**而不是装饰：
 * 这个区域是怎么被填满的、从哪里触发。
 *
 * 尺寸与颜色取应用内既有的次要文字档（text-xs / text-muted-foreground / text-subtle-foreground），
 * 与 Sidebar 的「暂无最近 Session」保持同一语气；不做插图、不放主按钮——
 * 空态不该比内容本身更吸睛。
 *
 * 注释里不写任意透明度：文字层级只有三档，用令牌而不是 color-mix 或 /60 这类写法。
 */
function BayBarEmptyState() {
  const translate = use_translation("navigation");
  return <div className="flex h-full min-h-0 flex-col items-center justify-center gap-2 px-6 text-center">
    <TbLayoutSidebarRight className="size-6 shrink-0 text-subtle-foreground" aria-hidden="true" />
    <div className="text-xs text-muted-foreground">{translate("panels.empty_title")}</div>
    <p className="max-w-56 text-2xs leading-5 text-subtle-foreground">{translate("panels.empty_description")}</p>
  </div>;
}

/**
 * 面板本体：宽度、缩放把手、标签行与内容。
 *
 * `open` 与「有没有标签页」无关：展开但 `active` 为空时就是一张空白标签页
 * （标签行为空、内容区为空），而不是不渲染。
 */
function BayBarPanel({ open, active, active_id, tabs, section_id, range }: {
  /** 面板是否展开。 */
  open: boolean;
  /** 当前标签页；为空表示空白标签页。 */
  active: BayBarTab | null;
  /** 当前标签页 id。 */
  active_id: string | null;
  /** 全部已打开的标签页，用于标签行。 */
  tabs: readonly BayBarTab[];
  /** 当前标签页内选择的分区。 */
  section_id: string | null;
  /** 由 BayBar 量得的可用宽度与正文下限；available 为 0 表示尚未测量。 */
  range: { available: number; floor: number };
}) {
  const baybar = useContext(BayBarContext);
  const translate = use_translation("navigation");
  const activate = baybar?.activate;
  const close_tab = baybar?.close_tab;
  const select_section = baybar?.select_section;
  const collapsed = !open;

  const [stored_width, set_stored_width] = useState(() => Number(localStorage.getItem("downcity.baybar_width")) || SHELL_BAYBAR_DEFAULT_WIDTH);
  // 上限 = 可用宽度 − 正文下限，剩下的都归右栏。
  // 未测量到（首帧）时不能夹取：那会把用户存下的宽度截成 0，看起来像「宽度没有持久化」。
  const max_width = range.available > 0
    ? resolve_baybar_max_width(range.available, range.floor)
    : Math.max(SHELL_BAYBAR_MIN_WIDTH, Math.round(stored_width));
  // 装不下「正文下限 + 右栏下限」时让位的是右栏：下限退到上限，否则 min > max、夹取无解。
  const squeezed = max_width < SHELL_BAYBAR_MIN_WIDTH;
  const min_width = squeezed ? max_width : SHELL_BAYBAR_MIN_WIDTH;

  const { current_width, is_resizing, handle_resize_start, resize_handle_props } = use_horizontal_resize({
    stored_width,
    min_width,
    max_width,
    default_width: SHELL_BAYBAR_DEFAULT_WIDTH,
    // 面板在右栏最左侧，左边缘贴着正文，因此拖动左边缘、向左为增宽。
    resize_edge: "left",
    // 被窗口挤窄时用户并没选过这个宽度，不写回偏好（否则缩一次窗口就丢了原宽度）。
    on_width_change: (width) => {
      if (squeezed) return;
      set_stored_width(width);
      localStorage.setItem("downcity.baybar_width", String(width));
    },
  });

  // 收起动画期间保留内容：否则收起会先清空内容再收缩，看起来像闪一下。
  const [mounted, set_mounted] = useState(open);
  useEffect(() => {
    if (open) set_mounted(true);
  }, [open]);
  // 只有收起动画进行中才沿用最后一个标签页，否则关掉它之后会继续显示旧内容。
  const last_tab_ref = useRef<BayBarTab | null>(active);
  if (active) last_tab_ref.current = active;
  const shown_tab = collapsed ? last_tab_ref.current : active;

  // 标签行里的方向键导航；与 SegmentedControl 同一套语义（含 Home / End）。
  // roving tabIndex 下只有当前标签页是 Tab 键可达的，切换后必须跟着移动焦点，
  // 否则焦点会留在已是 tabIndex=-1 的元素上，下一次 Tab 直接跳出去。
  const tablist_ref = useRef<HTMLDivElement>(null);
  const handle_tab_key_down = (event: KeyboardEvent<HTMLDivElement>, tab_id: string) => {
    const index = tabs.findIndex((item) => item.id === tab_id);
    if (index === -1 || tabs.length < 2) return;
    let next_index: number | null = null;
    if (event.key === "ArrowLeft" || event.key === "ArrowUp") next_index = (index - 1 + tabs.length) % tabs.length;
    if (event.key === "ArrowRight" || event.key === "ArrowDown") next_index = (index + 1) % tabs.length;
    if (event.key === "Home") next_index = 0;
    if (event.key === "End") next_index = tabs.length - 1;
    if (next_index === null) return;
    event.preventDefault();
    const next = tabs[next_index]!;
    activate?.(next.id);
    tablist_ref.current?.querySelector<HTMLElement>(`[data-baybar-tab="${CSS.escape(next.id)}"]`)?.focus();
  };

  const no_drag_style = { WebkitAppRegion: "no-drag" } as CSSProperties;
  const section: BayBarSection | null = shown_tab ? resolve_section(shown_tab, section_id) : null;
  // 只有一个分区时没有可选项，不显示分段按钮。
  const show_section_tabs = (shown_tab?.sections.length ?? 0) > 1;

  // 列结构：内层裁切（折叠动画在此），把手与它同级——放进裁切层里负偏移会被裁掉一半。
  return <>
    <motion.aside
      initial={false}
      animate={{ width: collapsed ? 0 : current_width }}
      transition={is_resizing ? { duration: 0 } : SHELL_PANEL_TRANSITION}
      onAnimationComplete={() => { if (collapsed) set_mounted(false); }}
      // 不铺卡片底色、不画外框：与 Sidebar 一样是窗口背景上的面板，靠卡片边框与间距分层次。
      // min-w-0 + shrink 而非 flex-none：可用区域不足以同时满足正文下限时让面板先让步。
      //
      // 这一层是折叠动画的裁切层：收起时里面固定宽度的内容必须被裁掉。
      className="relative flex h-full min-h-0 min-w-0 shrink overflow-hidden bg-muted"
      aria-label={translate("panels.rail")}
    >
      <div className={cn("relative flex h-full min-h-0 flex-col", collapsed && "invisible")} style={{ width: current_width }}>
        {mounted ? <>
          {/* 标签行。样式对齐应用内最近的同类元素（Button 的 sidebar 尺寸：
              rounded-control / hover:bg-interaction-hover / 选中 bg-interaction-selected），
              不自己发明一套。

              三个设计取舍：
              1. **不用胶囊**。整行只有 40px，胶囊的圆角半径会接近半高，看上去像一组按钮；
                 改为 rounded-control（与默认 Button 同档），才读得出「标签行」而不是「按钮群」。
              2. **不用下划线**。激活态只用一块填充底色（且用语义令牌，不自创颜色），
                 也不再画横向分隔线——左侧 Sidebar 的顶栏本来就没有分隔线。
              3. **不用边框**。描边 + 底色 + 圆角叠在一起就是之前那种“重”的来源；
                 只靠底色与文字色表达选中即可。

              两条几何约束：
              1. 行高 = Sidebar 顶栏，三列内容中心才同在 20px 基准线上；
              2. 容器带 header-drag-region（= -webkit-app-region: drag）用于拖窗口，
                 **因此每个标签页必须显式 no-drag**——否则点击会被窗口拖拽吞掉，
                 表现为「标签页点不动」，双击还会触发系统的最小化/缩放。 */}
          <div
            ref={tablist_ref}
            role="tablist"
            aria-label={translate("panels.rail")}
            className="header-drag-region scrollbar-none flex shrink-0 items-center gap-1 overflow-x-auto px-2 pr-8"
            style={{ height: SHELL_HEADER_HEIGHT_CSS }}
          >
            {tabs.map((item) => {
              const is_active = item.id === active_id;
              return <div
                key={item.id}
                role="tab"
                aria-selected={is_active}
                aria-label={item.label}
                // 标题会被 max-w-40 截断；悬停时给出全文（对象名可能很长）。
                title={item.label}
                // roving tabIndex：只有当前标签页是 Tab 键可达的，其余靠方向键切换。
                tabIndex={is_active ? 0 : -1}
                data-baybar-tab={item.id}
                style={no_drag_style}
                // 点标签页是「切换」，不是「关闭」：关闭由右侧的 × 负责。
                onClick={() => activate?.(item.id)}
                onKeyDown={(event) => handle_tab_key_down(event, item.id)}
                className={cn(
                  "group/tab inline-flex h-7 min-w-0 max-w-40 shrink-0 cursor-default select-none items-center gap-1.5 rounded-control pl-2 outline-none transition-colors duration-150",
                  "focus-visible:ring-2 focus-visible:ring-ring/30",
                  // 激活项右侧让出 × 的位置，未激活项两端对称。
                  is_active
                    ? "bg-interaction-selected pr-0.5 text-foreground"
                    : "pr-2 text-muted-foreground hover:bg-interaction-hover hover:text-foreground",
                )}
              >
                {/* 图标包一层定尺寸的容器：react-icons 默认 1em，在 text-xs 下只有 12px，
                    比标签文字小一号且基线不齐。用容器而不是 [&_svg] 通配，
                    免得把关闭按钮自己的图标也一起改大。 */}
                <span className="flex size-3.5 shrink-0 items-center justify-center [&>svg]:size-3.5 [&>img]:size-3.5">{item.icon}</span>
                <span className="truncate text-xs">{item.label}</span>
                {is_active ? <button
                  type="button"
                  style={no_drag_style}
                  tabIndex={-1}
                  title={translate("panels.close_right")}
                  aria-label={`${translate("panels.close_right")}：${item.label}`}
                  // 只关这一个标签页；关掉当前页会接到相邻的一个，关掉最后一个则是空白标签页。
                  onClick={(event) => { event.stopPropagation(); close_tab?.(item.id); }}
                  className="flex size-5 shrink-0 items-center justify-center rounded-control text-muted-foreground outline-none transition-colors hover:bg-interaction-hover hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/30"
                ><TbX className="size-3.5" /></button> : null}
              </div>;
            })}
          </div>
          {show_section_tabs && shown_tab && active_id ? <div className="shrink-0 px-2 py-2">
            <SegmentedControl<string>
              value={section?.id ?? ""}
              options={shown_tab.sections.map((item) => ({ value: item.id, label: item.label }))}
              on_value_change={(next_section_id) => select_section?.(active_id, next_section_id)}
              aria_label={shown_tab.label}
            />
          </div> : null}
          <div className="min-h-0 flex-1 overflow-y-auto">{section?.content ?? <BayBarEmptyState />}</div>
        </> : null}
      </div>
    </motion.aside>
    {/* 缩放把手：与左侧 Sidebar 的把手共用一套几何与交互（见 PanelResizeHandle）。
        它与裁切层同级，外缘因此能与卡片边缘重合，而不是退回面板内部。 */}
    {!collapsed ? <PanelResizeHandle side="left" label={translate("panels.resize_right")} resize_handle_props={resize_handle_props} on_resize_start={handle_resize_start} /> : null}
  </>;
}
