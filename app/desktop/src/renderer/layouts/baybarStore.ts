/**
 * 右侧 BayBar 面板的状态 store。
 *
 * ## 四个字段，边界清楚
 *
 * | 字段 | 含义 | 谁改它 |
 * |---|---|---|
 * | `open` | 面板这一列显示不显示 | 开关按钮、窄窗口自动收起、打开内容时自动展开 |
 * | `tabs` | 已打开的标签页（含描述与内容） | 打开新标签页、关闭标签页 |
 * | `active_id` | 当前显示哪一个 | 切换、打开、关闭（接替邻居） |
 * | `section_by_tab` | 各标签页当前的分区 | 点击分区按钮 |
 *
 * ## 三条不变量
 *
 * 1. **`open` 与 `tabs` 无关。** 展开着但一个标签页都没有是合法状态（空白标签页）。
 *    `close_tab` 只允许改 `tabs` 与 `active_id`，**永远不碰 `open`**。
 * 2. **标签页自包含。** 打开时收下完整的描述与内容，之后不依赖任何视图是否还活着。
 * 3. **重复打开不重建内容。** 已经打开过的标签页再次被打开时，
 *    只刷新标题与图标，**保留原来的 sections**——sections 换成新元素会让 React
 *    重新挂载内容组件，正在编辑的东西就丢了。
 *
 * 只有 `open` 持久化：标签页是会话内的状态，跨重启恢复需要把渲染器也持久化，
 * 那是另一个量级的复杂度，且没有实际需求。
 */

import { useCallback, useMemo } from "react";
import { use_store } from "@/lib/store";
import type { Store } from "@/types/DesktopStore";
import type { BayBarTab } from "./baybarPanelState";
import { baybar_open_storage_key, parse_stored_flag, resolve_active_after_close, apply_tab_label } from "./baybarPanelState";

/** BayBar 的完整不可变快照。 */
export interface BayBarStoreState {
  /** 面板是否展开。这是决定折叠的唯一字段。 */
  open: boolean;
  /** 已打开的标签页，按打开顺序。 */
  tabs: readonly BayBarTab[];
  /** 当前显示的标签页；为空表示空白标签页。 */
  active_id: string | null;
  /** 各标签页当前的分区（标签页 id → 分区 id）。 */
  section_by_tab: Readonly<Record<string, string>>;
}

/** 面板 store 句柄与它对外暴露的动作。 */
export interface BayBarStore {
  /** 供 use_store_selector 订阅的稳定句柄。 */
  store: Store<BayBarStoreState>;
  /** 同步读取最新快照，不触发渲染。 */
  state_ref: { current: BayBarStoreState };
  /**
   * 打开一个标签页并展开面板；已打开过则直接切过去。
   *
   * `tab` 由调用方在点击处构造（见各 feature 的 `*_tab()`），因此面板不需要
   * 认识任何业务内容，也不需要「谁声明了哪些标签页」这种注册协议。
   * `section_id` 可选：正文里的入口（「Model」行、diff 卡片）用它直接落到具体分区。
   */
  open_tab(tab: BayBarTab, section_id?: string): void;
  /** 关闭一个标签页。**不会收起面板**；关掉最后一个的结果是空白标签页。 */
  close_tab(tab_id: string): void;
  /**
   * 刷新一个已打开标签页的标题。
   *
   * 供标签页内容的宿主同步**外部会变**的标题（如 Session 标题由首条消息异步生成、
   * 之后还可能被重命名）。标签页只在打开时收下一次标题，所以没有这条通路时，
   * 打开得早的标签页会永远停在当时那个值上。
   *
   * 只改 `label`：`icon` 与 `sections` 保持不动，后者换掉会重新挂载内容、
   * 丢掉用户正在编辑的东西。标签页不存在或标题未变时不做任何提交。
   */
  set_tab_label(tab_id: string, label: string): void;
  /** 切换当前标签页。 */
  activate(tab_id: string): void;
  /** 切换某个标签页内的分区。 */
  select_section(tab_id: string, section_id: string): void;
  /** 展开面板（`open` 置真，并修正失效的当前标签页）。 */
  expand(): void;
  /** 收起面板。保留 `active_id`，下次展开回到同一处。 */
  collapse(): void;
  /** 开关面板。这是折叠按钮唯一的入口。 */
  toggle(): void;
}

/** 初始状态：收起、没有标签页。 */
const initial_baybar_state: BayBarStoreState = {
  open: false,
  tabs: [],
  active_id: null,
  section_by_tab: {},
};

/**
 * 壳外场景（单测、独立渲染组件）使用的常量空 store。
 * 面板相关 Hook 必须无条件调用订阅，因此需要一个永远返回空快照的兜底句柄。
 */
export const empty_baybar_store: Store<BayBarStoreState> = {
  subscribe: () => () => undefined,
  get_snapshot: () => initial_baybar_state,
};

/** 持久化面板开合状态。 */
function persist_open(open: boolean): void {
  localStorage.setItem(baybar_open_storage_key, String(open));
}

/** 创建 BayBar store。 */
export function use_baybar_store(): BayBarStore {
  // 惰性读一次：直接写在 use_store 的参数里会每次渲染都读 localStorage。
  const initial = useMemo<BayBarStoreState>(() => ({
    ...initial_baybar_state,
    open: parse_stored_flag(localStorage.getItem(baybar_open_storage_key)),
  }), []);
  const { store, state_ref, commit } = use_store<BayBarStoreState>(initial);

  const open_tab = useCallback((tab: BayBarTab, section_id?: string) => {
    const current = state_ref.current;
    const existing = current.tabs.find((item) => item.id === tab.id);
    // 已打开过：只刷新标题与图标，保留原 sections（换掉会重新挂载内容、丢失编辑中的状态）。
    const tabs = existing
      ? current.tabs.map((item) => (item.id === tab.id ? { ...item, label: tab.label, icon: tab.icon } : item))
      : [...current.tabs, tab];
    const section_by_tab = section_id
      ? { ...current.section_by_tab, [tab.id]: section_id }
      : current.section_by_tab;
    persist_open(true);
    // 一次提交：分多次会让面板先展开再换内容，中途闪一帧旧内容。
    commit({ ...current, open: true, tabs, active_id: tab.id, section_by_tab });
  }, [commit, state_ref]);

  const close_tab = useCallback((tab_id: string) => {
    const current = state_ref.current;
    if (!current.tabs.some((item) => item.id === tab_id)) return;
    const tabs = current.tabs.filter((item) => item.id !== tab_id);
    const active_id = resolve_active_after_close(current.tabs.map((item) => item.id), current.active_id, tab_id);
    const section_by_tab = Object.fromEntries(Object.entries(current.section_by_tab).filter(([id]) => id !== tab_id));
    // 只改 tabs / active_id / section_by_tab，**不碰 open**：关标签页不会关掉面板。
    commit({ ...current, tabs, active_id, section_by_tab });
  }, [commit, state_ref]);

  const activate = useCallback((tab_id: string) => {
    const current = state_ref.current;
    if (!current.tabs.some((item) => item.id === tab_id)) return;
    if (current.open && current.active_id === tab_id) return;
    persist_open(true);
    commit({ ...current, open: true, active_id: tab_id });
  }, [commit, state_ref]);

  /**
   * 刷新一个已打开标签页的标题。
   *
   * 只改 `label`，**不碰 icon / sections**：sections 换新元素会让 React 重新挂载
   * 内容组件，正在编辑的东西就丢了（与 `open_tab` 里重复打开时的取舍一致）。
   * 标题未变或标签页不存在时直接返回，不产生无意义提交。
   */
  const set_tab_label = useCallback((tab_id: string, label: string) => {
    const current = state_ref.current;
    const tabs = apply_tab_label(current.tabs, tab_id, label);
    if (tabs === current.tabs) return;
    commit({ ...current, tabs });
  }, [commit, state_ref]);

  const select_section = useCallback((tab_id: string, section_id: string) => {
    const current = state_ref.current;
    if (current.section_by_tab[tab_id] === section_id) return;
    commit({ ...current, section_by_tab: { ...current.section_by_tab, [tab_id]: section_id } });
  }, [commit, state_ref]);

  const expand = useCallback(() => {
    const current = state_ref.current;
    // 当前标签页可能已失效（刚被关掉）：退到第一个，否则用户看到空白却以为坏了。
    const active_id = current.active_id && current.tabs.some((item) => item.id === current.active_id)
      ? current.active_id
      : (current.tabs[0]?.id ?? null);
    if (current.open && current.active_id === active_id) return;
    persist_open(true);
    commit({ ...current, open: true, active_id });
  }, [commit, state_ref]);

  const collapse = useCallback(() => {
    const current = state_ref.current;
    if (!current.open) return;
    persist_open(false);
    // 特意不清 active_id：收起只是「先不看」，不是「不记得在看什么」。
    commit({ ...current, open: false });
  }, [commit, state_ref]);

  const toggle = useCallback(() => {
    const current = state_ref.current;
    if (current.open) {
      persist_open(false);
      commit({ ...current, open: false });
      return;
    }
    const active_id = current.active_id && current.tabs.some((item) => item.id === current.active_id)
      ? current.active_id
      : (current.tabs[0]?.id ?? null);
    persist_open(true);
    commit({ ...current, open: true, active_id });
  }, [commit, state_ref]);

  return useMemo<BayBarStore>(() => ({
    store,
    state_ref,
    open_tab,
    close_tab,
    set_tab_label,
    activate,
    select_section,
    expand,
    collapse,
    toggle,
  }), [activate, close_tab, collapse, expand, open_tab, select_section, set_tab_label, state_ref, store, toggle]);
}
