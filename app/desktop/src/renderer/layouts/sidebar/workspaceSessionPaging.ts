/**
 * Works 会话列表的分页规则：一个 Workspace 默认只列最近的若干条。
 *
 * ## 为什么需要它
 *
 * 一个用得久的 Workspace 会攒下几百条会话，全部列出来会把下面的 Workspace 推到屏幕之外，
 * 而绝大多数时候用户要找的就是最近那几条。因此默认只列一页，其余按需加载。
 *
 * ## 窗口必须覆盖「用户正在处理的东西」
 *
 * 只按「最近 N 条」截断会漏掉两类行，而它们恰恰是最不能隐藏的：
 *
 * | 情形 | 不处理的后果 |
 * | --- | --- |
 * | 当前打开的会话在窗口之外 | 重启后恢复到第 30 条，侧栏里看不到自己在哪一条 |
 * | 已选中的会话在窗口之外 | 工具条的「已选 N 项」比看得见的勾选多，批量操作还会动到看不见的对象 |
 *
 * 因此窗口的下界不是「一页」，而是「一页，且至少覆盖到最靠后的那个必须可见的项」。
 * 这一条与「当前所在的 Workspace 初始就是展开的」是同一个判据：
 * **我在哪 / 我选了什么，比列表整洁更要紧**。
 *
 * ## 与多选的关系
 *
 * 分页是**浏览**的手段，不是限制操作的手段：进入多选后仍然分页，但已选项由上面那条规则
 * 保证可见。这比「多选时一次渲染全部」好——后者在几百条的 Workspace 上会直接卡住。
 */

/** 一页的条数：一个 Workspace 默认列出的会话数。 */
export const session_page_size = 10;

/**
 * 算出这个 Workspace 现在该显示几条。
 *
 * ```text
 * 可见条数 = min( 总数, max( 已加载页数, 必须可见项的下标 + 1 ) )
 * ```
 *
 * 三段各回答一件事：
 *
 * - `loaded_count` 是用户点了几次「更多」的结果，下界是一页；
 * - `must_include_index` 是「当前打开项」与「已选项」里最靠后的那个下标；
 * - 上限是总数，因此不会算出一个超出实际长度的窗口。
 */
export function resolve_visible_count(options: {
  /** 用户已经加载到几条（含默认那一页）；未记录时传 0。 */
  loaded_count: number;
  /** 这个 Workspace 实际有多少条。 */
  total_count: number;
  /**
   * 必须可见的最靠后一项的下标（0 基）；没有则传 null。
   *
   * 由调用方取「当前打开项」与「已选项」下标的最大值——两者都要看得见，理由见文件头。
   */
  must_include_index: number | null;
}): number {
  const { loaded_count, total_count, must_include_index } = options;
  const base = Math.max(loaded_count, session_page_size);
  const with_required = must_include_index === null ? base : Math.max(base, must_include_index + 1);
  return Math.min(with_required, total_count);
}

/**
 * 取「必须可见项」的下标：当前打开项与已选项里最靠后的那个。
 *
 * 返回 null 表示这个 Workspace 里没有任何必须可见的行，此时窗口就是一页。
 * 两个入参都是 key 列表，与列表里的 `entry.key` 同一套。
 */
export function resolve_must_include_index(options: {
  /** 这个 Workspace 的全部会话 key，按列表顺序。 */
  ordered_keys: readonly string[];
  /** 当前打开的会话 key；没有则传 undefined。 */
  active_key?: string;
  /** 已选中的会话 key。 */
  selected_keys: readonly string[];
}): number | null {
  const { ordered_keys, active_key, selected_keys } = options;
  const index_of = new Map(ordered_keys.map((key, index) => [key, index]));
  let last: number | null = null;
  const consider = (key: string | undefined) => {
    if (!key) return;
    const index = index_of.get(key);
    if (index === undefined) return;
    if (last === null || index > last) last = index;
  };
  consider(active_key);
  for (const key of selected_keys) consider(key);
  return last;
}

/** 加载下一页之后的新条数：在当前可见条数上再加一页。 */
export function next_page_count(current_count: number, total_count: number): number {
  return Math.min(current_count + session_page_size, total_count);
}
