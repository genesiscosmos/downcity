/**
 * Works 会话树的折叠状态：读取、写入与容错。
 *
 * ## 为什么单独成模块
 *
 * 解析逻辑必须能被单测直接跑：`localStorage` 里的内容是**不可信输入**——它可能被手改、
 * 被旧版本写过、或跨版本留下已经删除的 Workspace id。把这些判断塞进组件里，
 * 就只能靠渲染来验证，而这类边界恰好是最容易写错的地方。
 * 因此这里不引入 React 运行时，也不自己读 `localStorage`（存取由调用方给）。
 *
 * ## 存的是「展开的那几个」而不是「折叠的那几个」
 *
 * 与 `downcity.sidebar_width` 同一层（`localStorage`），理由也一样：这是**壳的显示偏好**，
 * 不是业务数据，不需要跟着设置一起走主进程。
 *
 * 存展开集合而不是折叠集合：绝大多数 Workspace 是折叠的，只记展开的那几个，
 * 存储量跟着用户实际展开的数量走，而不是跟着 Workspace 总数走。
 */

/** 折叠状态在 localStorage 中的唯一键。 */
export const workspace_expanded_storage_key = "downcity.workspace_expanded_ids";

/**
 * 把不可信的存储内容解析成展开集合。
 *
 * 只接受字符串数组：其它任何形状（对象、数字、null、坏 JSON）都当作「没有存过」，
 * 而不是抛错或猜一个值——折叠状态坏了不该让侧栏打不开。
 */
export function parse_expanded_ids(serialized: string | null): string[] {
  if (!serialized) return [];
  try {
    const value: unknown = JSON.parse(serialized);
    if (!Array.isArray(value)) return [];
    return value.filter((item): item is string => typeof item === "string" && item.length > 0);
  } catch {
    return [];
  }
}

/** 把展开集合序列化。 */
export function format_expanded_ids(expanded_ids: Iterable<string>): string {
  return JSON.stringify([...expanded_ids]);
}

/**
 * 把存储里读到的 id 收敛到当前存在的 Workspace。
 *
 * 已经移除的 Workspace 会留在存储里，不清掉的话集合会一直变大，
 * 而且用户重新添加同名目录时会被莫名其妙地自动展开。
 */
export function prune_expanded_ids(expanded_ids: readonly string[], workspace_ids: readonly string[]): string[] {
  const known = new Set(workspace_ids);
  return expanded_ids.filter((workspace_id) => known.has(workspace_id));
}

/**
 * 计算初始展开集合：存储里那一份，加上当前所在的 Workspace。
 *
 * ```text
 * 初始 = prune(存储里的 id) ∪ { 当前所在的 Workspace }
 * ```
 *
 * 两部分各自回答一件事，缺一不可：
 *
 * - **存储那一份**是用户上次的选择（包括他展开过的其它 Workspace）；
 * - **当前所在的那个**必须补上：用户在会话里点一下 Workspace 图标切回侧栏时，
 *   必须能看到自己刚才在哪一条。这一条是旧行为，不因加了持久化而变。
 *
 * 代价说清楚：手动折叠**当前** Workspace 后重新挂载（切侧栏、重启），它会被重新展开。
 * 这是有意的取舍——「我在哪」比「我折过它」更需要被看到；
 * 折叠其它 Workspace 则会被完整记住。
 *
 * `prune` 不能省：已移除的 Workspace 会留在存储里，不清掉集合会一直变大，
 * 而且用户重新添加同名目录时会被莫名其妙地自动展开。
 */
export function resolve_initial_expanded_ids(options: {
  /** 存储里读到的展开集合；没存过时为空。 */
  stored_ids: readonly string[];
  /** 当前存在的 Workspace；用于剔除失效 id。 */
  workspace_ids: readonly string[];
  /** 当前所在的 Workspace；为空时不补。 */
  selected_workspace_id?: string;
}): Set<string> {
  const { stored_ids, workspace_ids, selected_workspace_id } = options;
  const next = new Set(prune_expanded_ids(stored_ids, workspace_ids));
  if (selected_workspace_id && workspace_ids.includes(selected_workspace_id)) next.add(selected_workspace_id);
  return next;
}
