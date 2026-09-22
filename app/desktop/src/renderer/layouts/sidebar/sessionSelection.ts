/**
 * Works 会话树的多选状态：纯函数，没有 React 依赖。
 *
 * ## 为什么状态是「一串 key」而不是「一组对象」
 *
 * 选中的是**位置**（哪一条会话），不是会话本身：会话摘要会被运行态刷新、标题会被改名，
 * 而它在这棵树里的身份（`agent:<agent_id>:<session_id>` / `group:<group_id>:<session_id>`）
 * 是稳定的。用 key 表达选择，改名与状态变化都不会打断一次正在进行的多选。
 *
 * ## 范围选择是「替换」，不是「并集」
 *
 * 这一条踩过坑，值得写清：最初实现是**并集**（把新范围并进已有选择），而锚点固定在
 * 「当前打开的那条会话」上。两者相乘的结果是——连续 Shift 点击时，每次都从同一个起点
 * 取范围再并进去，点几次就把整列选中了。用户看到的是「Shift 点一下，全选了」。
 *
 * 现在两者都改了：
 *
 * - **锚点前进**：锚点就是**上一次点击的那一项**（每次点击都移过去）；
 * - **范围替换**：结果就是「锚点到当前项」这一段，不并进已有选择。
 *
 * 于是连续 Shift 点击是**逐段选择**：点 A、Shift 点 C 得 A..C，再 Shift 点 E 得 C..E。
 * 这与 Finder 的多选有一处有意差别——Finder 的锚点不动，所以第二次 Shift 会得到 A..E。
 * 逐段选择更贴合「上一次点击的 item 到这一项」这句话的字面意思，也是这个侧栏里想要的手感。
 */

/** 在选中集合里切换一条；已选则移除，未选则加入。 */
export function toggle_session_selection(selected_keys: readonly string[], key: string): string[] {
  return selected_keys.includes(key)
    ? selected_keys.filter((item) => item !== key)
    : [...selected_keys, key];
}

/**
 * 取「锚点到当前项」的连续段，作为**新的完整选择**。
 *
 * 结果是**有序的**（按 `ordered_keys` 的顺序），而不是按点击顺序：这样列表顺序一确定，
 * 选择集合的引用就稳定，行组件的 memo 不会因为点击顺序不同而失效。
 *
 * 锚点或当前项不在可见列表里时退化成只选当前项——范围无从谈起时，那是唯一说得通的动作。
 * 锚点失效的常见原因是它指向的会话在选中过程中被删除了。
 */
export function select_session_range(
  ordered_keys: readonly string[],
  anchor_key: string | null,
  current_key: string,
): string[] {
  const start = anchor_key === null ? -1 : ordered_keys.indexOf(anchor_key);
  const end = ordered_keys.indexOf(current_key);
  if (start === -1 || end === -1) return [current_key];
  // 反向拖选（从下往上）与正向是同一段，因此先归一化两端。
  const [from, to] = start <= end ? [start, end] : [end, start];
  return ordered_keys.slice(from, to + 1);
}

/**
 * 把已经不在可见列表里的 key 从选择里剔除。
 *
 * 会话被删除、或用户切走 Workspace 之后，原来的选择里会留下指向不存在行的 key。
 * 不清掉它们，工具条上的「已选 N 项」会一直比看得见的勾选多，而批量操作会去动
 * 那些已经不存在的对象。
 */
export function prune_session_selection(selected_keys: readonly string[], visible_keys: readonly string[]): string[] {
  const visible = new Set(visible_keys);
  return selected_keys.filter((key) => visible.has(key));
}
