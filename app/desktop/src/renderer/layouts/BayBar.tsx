/**
 * Desktop MainView 的右侧 BayBar。
 *
 * 结构（本模块的核心契约）：
 *
 * ```
 * MainView（一张卡：圆角 + 边框）
 * ├── MainContent = children
 * └── BayBar
 * ```
 *
 * 三条边界规则：
 * 1. **BayBar 属于 MainView，不属于 Shell。** 右栏是当前视图的上下文细节，
 *    只有视图知道该显示什么；Shell 完全不需要知道它的存在。
 * 2. **Provider 必须包住 MainContent 与 BayBar 两者。** 正文里的入口
 *    （header 头像、消息里的 Agent 名、diff 卡片等）通过 context 打开面板，
 *    一旦 Provider 只包住 BayBar，这些入口就会拿到空实现而静默失效。
 * 3. **收起与选择是两个正交维度。** `collapsed` 只管可见性，`selection` 只管显示什么；
 *    收起时保留 selection，再次展开回到原处。
 */

import { createContext, useCallback, useContext, useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { motion } from "framer-motion";
import { use_horizontal_resize } from "@/hooks/use_horizontal_resize";
import { use_media_query } from "@/hooks/use_media_query";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { ShellBayBarControl } from "./ShellBayBarControl";
import { cn } from "@/lib/utils";
import { use_translation } from "@/locales/i18n";
import { BAYBAR_AUTO_COLLAPSE_WIDTH, resolve_shell_auto_collapse } from "./shellResponsive";
import type { BayBarDomain, BayBarSelection } from "./baybarPanelState";
import { baybar_storage_key, format_selection, parse_selection, resolve_domain_switch, resolve_selection } from "./baybarPanelState";
import { SHELL_BAYBAR_HEADER_RESERVE_CSS, SHELL_MAIN_VIEW_BAND_HEIGHT_CSS, SHELL_MAIN_VIEW_BAND_PADDING_BOTTOM_CSS, SHELL_PANEL_TRANSITION } from "./shellMotion";

export type { BayBarDomain, BayBarSection, BayBarSelection } from "./baybarPanelState";

const BAYBAR_MIN_WIDTH = 360;
const BAYBAR_MAX_WIDTH = 600;
const BAYBAR_DEFAULT_WIDTH = 400;

/** 打开某处内容：只给域时进入该域的第一个分区。 */
export type BayBarOpen = (domain_id: string, section_id?: string) => void;

/** 打开右侧面板；不在 MainView 内时为空实现。 */
const BayBarOpenContext = createContext<BayBarOpen>(() => undefined);

/**
 * 读取打开右侧面板的动作。
 * 正文里的入口用它打开面板，避免从页面一路把回调透传到叶子组件。
 */
export function use_baybar_open(): BayBarOpen {
  return useContext(BayBarOpenContext);
}

/**
 * MainView Header 需要的右侧预留信息。
 * 折叠时固定的折叠按钮会浮在 Header 之上，Header 必须让出等宽空间。
 */
interface BayBarChrome {
  /** 是否需要为折叠按钮预留空间。 */
  reserved: boolean;
  /**
   * 预留宽度，CSS 长度值。
   *
   * 类型是 string 而不是 number：预留量含卡片边框这类固定像素，
   * 只有 CSS 长度能同时表达「跟随缩放的按钮宽度」与「不跟随缩放的细线」。
   */
  inset: string;
}

const BayBarChromeContext = createContext<BayBarChrome>({ reserved: false, inset: "0px" });

/** 读取右侧预留信息；不在 MainView 内时不需要预留。 */
export function use_baybar_chrome(): BayBarChrome {
  return useContext(BayBarChromeContext);
}

/**
 * MainView：把内容与右侧 BayBar 组合成一张卡。
 *
 * `children` 接收打开动作，供页面级入口使用；
 * 更深的入口直接用 use_baybar_open()。
 */
export function MainView({ view_key, domains = [], children }: {
  /** 当前视图的稳定标识；用于按视图记忆显示位置。为空时不提供右侧。 */
  view_key?: string;
  /** 当前视图提供的域；为空时右侧整体不存在。 */
  domains?: BayBarDomain[];
  /** 内容区；参数为打开动作。 */
  children: (open: BayBarOpen) => ReactNode;
}) {
  const storage_key = view_key ? baybar_storage_key(view_key) : "";
  const [stored, set_stored] = useState<BayBarSelection | null>(() => storage_key ? parse_selection(localStorage.getItem(storage_key)) : null);
  // 切换视图时恢复该视图上次的显示位置。
  useEffect(() => {
    set_stored(storage_key ? parse_selection(localStorage.getItem(storage_key)) : null);
  }, [storage_key]);
  // 选择是派生值：域集合变化时自动回退到有效位置，不需要额外的同步逻辑。
  const selection = resolve_selection(domains, stored);
  const [collapsed, set_collapsed] = useState(true);
  // 窗口窄到正文会被挤没时自动收起；面板自身保留展开能力，不锁死用户操作。
  const narrow_window = use_media_query(`(max-width: ${BAYBAR_AUTO_COLLAPSE_WIDTH}px)`);
  const auto_collapsed_ref = useRef(false);
  useEffect(() => {
    const next = resolve_shell_auto_collapse({
      narrow: narrow_window,
      collapsed,
      auto_collapsed: auto_collapsed_ref.current,
    });
    auto_collapsed_ref.current = next.auto_collapsed;
    set_collapsed(next.collapsed);
    // collapsed 有意不进依赖：本效果只响应「窗口跨越断点」，否则用户展开会被立即覆盖。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [narrow_window]);

  const update_selection = useCallback((next: BayBarSelection | null) => {
    set_stored(next);
    if (!storage_key) return;
    if (next) localStorage.setItem(storage_key, format_selection(next));
    else localStorage.removeItem(storage_key);
  }, [storage_key]);
  const open = useCallback<BayBarOpen>((domain_id, section_id) => {
    const domain = domains.find((item) => item.id === domain_id);
    const target = section_id
      ? domain?.sections.find((item) => item.id === section_id)
      : domain?.sections[0];
    if (!domain || !target) return;
    update_selection({ domain_id: domain.id, section_id: target.id });
    set_collapsed(false);
  }, [domains, update_selection]);
  const select_domain = useCallback((domain_id: string) => {
    const next = resolve_domain_switch(domains, domain_id);
    if (next) update_selection(next);
  }, [domains, update_selection]);
  const select_section = useCallback((section_id: string) => {
    if (!selection) return;
    update_selection({ domain_id: selection.domain_id, section_id });
  }, [selection, update_selection]);

  const has_baybar = domains.length > 0;
  // 折叠按钮浮在 Header 之上，Header 需要让出等宽空间。
  const chrome: BayBarChrome = has_baybar && collapsed
    ? { reserved: true, inset: SHELL_BAYBAR_HEADER_RESERVE_CSS }
    : { reserved: false, inset: "0px" };
  return <BayBarOpenContext.Provider value={open}>
    <BayBarChromeContext.Provider value={chrome}>
      <div className="main-view relative flex h-full min-h-0 min-w-0 flex-1 overflow-hidden rounded-xl border border-border-subtle bg-background">
        <div className="flex h-full min-w-0 flex-1 flex-col">{children(open)}</div>
        {has_baybar ? <BayBarAside
          domains={domains}
          selection={selection}
          collapsed={collapsed}
          on_select_domain={select_domain}
          on_select_section={select_section}
        /> : null}
      </div>
      {has_baybar ? <ShellBayBarControl collapsed={collapsed} toggle_baybar={() => set_collapsed((value) => !value)} /> : null}
    </BayBarChromeContext.Provider>
  </BayBarOpenContext.Provider>;
}

/** 右侧面板本体：一级域 tab、二级分区选择、内容。 */
function BayBarAside({ domains, selection, collapsed, on_select_domain, on_select_section }: {
  /** 当前视图提供的域。 */
  domains: BayBarDomain[];
  /** 当前显示位置。 */
  selection: BayBarSelection | null;
  /** 是否收起。 */
  collapsed: boolean;
  /** 切换域。 */
  on_select_domain(domain_id: string): void;
  /** 切换分区。 */
  on_select_section(section_id: string): void;
}) {
  const translate = use_translation("navigation");
  const [stored_width, set_stored_width] = useState(() => Number(localStorage.getItem("downcity.baybar_width")) || BAYBAR_DEFAULT_WIDTH);
  // 折叠动画期间保留内容，避免收起过程中先消失再收缩。
  const [content_mounted, set_content_mounted] = useState(!collapsed);
  useEffect(() => {
    if (!collapsed) set_content_mounted(true);
  }, [collapsed]);
  const { current_width, is_resizing, handle_resize_start, resize_handle_props } = use_horizontal_resize({
    stored_width,
    min_width: BAYBAR_MIN_WIDTH,
    max_width: BAYBAR_MAX_WIDTH,
    default_width: BAYBAR_DEFAULT_WIDTH,
    resize_edge: "left",
    on_width_change: (width) => { set_stored_width(width); localStorage.setItem("downcity.baybar_width", String(width)); },
  });
  const show_content = content_mounted || !collapsed;
  const no_drag_style = { WebkitAppRegion: "no-drag" } as CSSProperties;
  const active_domain = selection ? domains.find((domain) => domain.id === selection.domain_id) : undefined;
  const active_section = active_domain && selection ? active_domain.sections.find((section) => section.id === selection.section_id) : undefined;
  // 只有多个域时才需要一级 tab；多个分区时才需要二级选择。
  const show_domain_tabs = domains.length > 1;
  const show_section_tabs = (active_domain?.sections.length ?? 0) > 1;

  return <motion.aside
    initial={false}
    animate={{ width: collapsed ? 0 : current_width }}
    transition={is_resizing ? { duration: 0 } : SHELL_PANEL_TRANSITION}
    onAnimationComplete={() => { if (collapsed) set_content_mounted(false); }}
    className={cn("relative flex h-full min-h-0 flex-none overflow-hidden", !collapsed && "border-l border-divider")}
    aria-label={translate("panels.rail")}
  >
    <div className="relative flex h-full min-h-0 flex-col" style={{ width: current_width }}>
      {show_content ? <>
        {/* 缩放把手：与左侧 Sidebar 一样同时支持拖拽与键盘方向键。 */}
        <div {...resize_handle_props} aria-label={translate("panels.resize_right")} onMouseDown={handle_resize_start} className="group absolute -left-[3px] top-0 z-10 flex h-full w-1.5 cursor-ew-resize items-center justify-center outline-none"><span className="h-8 w-0.5 rounded-full bg-transparent transition-colors group-hover:bg-muted-foreground group-focus-visible:bg-muted-foreground" /></div>
        {/* 标题行与 MainView Header 共用同一套卡片内顶栏几何，保证两侧内容同处一线。 */}
        <div className="header-drag-region flex shrink-0 items-center px-2" style={{ height: SHELL_MAIN_VIEW_BAND_HEIGHT_CSS, paddingBottom: SHELL_MAIN_VIEW_BAND_PADDING_BOTTOM_CSS }}>
          {show_domain_tabs
            // 一级：文字 title tab，当前项以颜色与字重区分，不使用背景块。
            ? <div role="tablist" style={no_drag_style} className="scrollbar-none flex min-w-0 flex-1 items-center gap-3 overflow-x-auto px-1">
              {domains.map((domain) => {
                const active = domain.id === active_domain?.id;
                return <button
                  key={domain.id}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => on_select_domain(domain.id)}
                  className={cn(
                    "inline-flex h-full shrink-0 items-center text-xs outline-none transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-ring/30",
                    active ? "font-medium text-foreground" : "text-muted-foreground hover:text-foreground",
                  )}
                >{domain.label}</button>;
              })}
            </div>
            // 只有一个域时没有可选项，标题直接说明当前域。
            // 只有一个域时没有可选项，标题直接说明当前域；不加额外水平内边距，与下方分区控件对齐。
            : <h2 className="min-w-0 flex-1 truncate text-xs font-medium text-muted-foreground">{active_domain?.label ?? ""}</h2>}
        </div>
        {show_section_tabs && active_domain && selection ? <div className="shrink-0 px-2 pb-2">
          <SegmentedControl<string>
            value={selection.section_id}
            options={active_domain.sections.map((section) => ({ value: section.id, label: section.label }))}
            on_value_change={on_select_section}
            aria_label={active_domain.label}
          />
        </div> : null}
        <div className="min-h-0 flex-1 overflow-y-auto">{active_section?.content ?? null}</div>
      </> : null}
    </div>
  </motion.aside>;
}
