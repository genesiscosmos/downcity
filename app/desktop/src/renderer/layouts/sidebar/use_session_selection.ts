/**
 * Works 会话树的多选模式状态与批量动作。
 *
 * ## 状态为什么在这一层
 *
 * 选择工具条在面板 header、可勾选的行在下面的列表里，两者都要读写同一份状态。
 * 放到任一侧都会让另一侧隔着组件树往回要。因此它挂在 `WorkspaceSidebar`：
 * header 与列表都从它取。
 *
 * ## 模式是显式的，不是一个「选择非空」的推断
 *
 * 「选了一条」与「正在多选」是两件事：前者在多选模式里随时可能变成空集（用户取消了最后一条），
 * 而那时工具条不该自己消失、普通点击也不该突然变回「打开会话」。因此 `selection_mode` 单独存，
 * 只有 Esc、退出按钮、或点空白处才结束它。
 *
 * ## 锚点是内部状态，且**每次点击都前进**
 *
 * 这是修掉一个真 bug 的关键。最初实现把锚点固定在「当前打开的那条会话」上（从外部传进来），
 * 而范围选择是并集——两者相乘：连续 Shift 点击时每次都从同一个起点取范围再并进去，
 * 点几次就把整列选中了，用户看到的是「Shift 点一下，全选了」。
 *
 * 现在锚点在这里，并且**每次点击都移到被点的那一项**（Shift 也不例外），
 * 而范围用的是**点击前**的锚点。因此连续 Shift 点击是逐段选择：
 *
 * | 动作 | 范围 | 锚点去向 |
 * | --- | --- | --- |
 * | 点 A | 只选 A | A |
 * | Shift 点 C | A..C | C |
 * | Shift 点 E | C..E | E |
 *
 * 这与「上一次点击的 item 到这一项」是同一句话：锚点就是上一次点击项。
 * 注意它与 Finder 有一处有意差别——Finder 的锚点不动，所以第二次 Shift 会得到 A..E。
 * 逐段选择更贴合连续点击时的直觉，也是这个侧栏里想要的手感。
 * 详见 `sessionSelection` 文件头。
 *
 * ## 失效的 key 必须剔除
 *
 * 会话被删除、切走 Workspace、目录重新水合之后，选择里会留下指向不存在行的 key。
 * 不清掉它们，工具条的计数会比看得见的勾选多，批量操作还会去动已经不存在的对象。
 * 锚点同理：它指向的会话被删掉时，下一次范围选择会退化成只选当前项（见 `select_session_range`）。
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  prune_session_selection,
  select_session_range,
  toggle_session_selection,
} from "./sessionSelection";

/** 一条可批量操作的目标。 */
export interface SessionSelectionTarget {
  /** 行内稳定 key，与列表里的 `entry.key` 一致。 */
  key: string;
  /** 会话类型；决定批量归档是否可用。 */
  kind: "agent" | "group";
  /** 这条会话所属的 Workspace。 */
  workspace_id: string;
  /** Agent 会话的 Agent 标识；Group 会话为空。 */
  agent_id?: string;
  /** Group 会话的 Group 标识；Agent 会话为空。 */
  group_id?: string;
  /** 会话标识。 */
  session_id: string;
}

/** 一次选择动作可用的有序 key；范围选择按它取连续段。 */
interface SelectOptions {
  /** 是否按范围选择。 */
  range?: boolean;
  /** 范围选择用的有序 key；不传则用全量列表顺序。 */
  ordered_keys?: readonly string[];
}

/** 多选状态与动作。 */
export interface SessionSelection {
  /** 是否处于多选模式。 */
  selection_mode: boolean;
  /** 已选中的行 key，按列表顺序。 */
  selected_keys: readonly string[];
  /** 已选中的目标（含批量操作需要的标识）。 */
  selected_targets: readonly SessionSelectionTarget[];
  /** 选一条；`range` 为真时从锚点选到它，否则切换它并把锚点移过来。 */
  select(key: string, options?: SelectOptions): void;
  /** 退出多选模式并清空选择与锚点。 */
  exit(): void;
}

/**
 * 维护多选模式。
 *
 * `ordered_keys` 是全部可见会话的顺序（用于剔除失效选择）；`targets_by_key` 提供批量操作
 * 需要的标识。范围选择用的有序 key 由调用方按**行所在的那一组**传进来，因此范围不会跨
 * 折叠着的 Workspace 取到用户看不见的行。
 */
export function use_session_selection(options: {
  /** 全部可见会话的 key，按列表顺序；用于剔除失效选择。 */
  ordered_keys: readonly string[];
  /** key → 批量操作目标。 */
  targets_by_key: ReadonlyMap<string, SessionSelectionTarget>;
}): SessionSelection {
  const { ordered_keys, targets_by_key } = options;
  const [selection_mode, set_selection_mode] = useState(false);
  const [stored_keys, set_stored_keys] = useState<readonly string[]>([]);
  /** 上一次点击的那一项；Shift 点击的范围起点。 */
  const [anchor_key, set_anchor_key] = useState<string | null>(null);

  // 可见集合变化后收敛一次：删掉的会话、切走的 Workspace 都不该继续占着选择。
  const selected_keys = useMemo(
    () => prune_session_selection(stored_keys, ordered_keys),
    [ordered_keys, stored_keys],
  );
  useEffect(() => {
    // 收敛结果与存下来的不同才回写，避免每次渲染都触发一轮状态更新。
    if (selected_keys.length !== stored_keys.length) set_stored_keys(selected_keys);
  }, [selected_keys, stored_keys.length]);

  /**
   * 选一条。
   *
   * 范围用**点击前**的锚点算，算完把锚点移到被点项。两者顺序不能反：
   * 先移锚点的话范围永远只有一项，连续 Shift 就失去意义。
   */
  const select = useCallback((key: string, options?: SelectOptions) => {
    const range_keys = options?.ordered_keys ?? ordered_keys;
    set_selection_mode(true);
    set_stored_keys((current) => options?.range
      ? select_session_range(range_keys, anchor_key, key)
      : toggle_session_selection(current, key));
    set_anchor_key(key);
  }, [anchor_key, ordered_keys]);

  const exit = useCallback(() => {
    set_selection_mode(false);
    set_stored_keys([]);
    set_anchor_key(null);
  }, []);

  // Esc 退出：与其它浮层同一套「退回一步」的手势，不需要用户去找退出按钮。
  useEffect(() => {
    if (!selection_mode) return;
    const handle_key_down = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented || event.isComposing) return;
      event.preventDefault();
      exit();
    };
    window.addEventListener("keydown", handle_key_down);
    return () => window.removeEventListener("keydown", handle_key_down);
  }, [exit, selection_mode]);

  const selected_targets = useMemo(
    () => selected_keys.flatMap((key) => {
      const target = targets_by_key.get(key);
      return target ? [target] : [];
    }),
    [selected_keys, targets_by_key],
  );

  return { selection_mode, selected_keys, selected_targets, select, exit };
}
