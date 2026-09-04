/**
 * TUI 列表循环选择辅助。
 *
 * 关键点（中文）
 * - 统一处理 sidebar 上下边界绕回，避免不同 TUI 面板行为不一致。
 * - 支持跳过 disabled 分区标题，只让可执行项目成为最终焦点。
 * - 该模块只处理索引计算，不依赖 blessed 实例，便于后续测试与复用。
 */

/**
 * 解析当前选中索引，遇到 disabled 项时按移动方向寻找最近可选项。
 */
export function resolve_loop_selectable_index(
  items: readonly unknown[],
  value: unknown,
  fallback: number,
): number {
  if (items.length <= 0) return 0;
  const candidate = normalize_index(value, items.length, fallback);
  if (!is_disabled_selectable_item(items[candidate])) {
    return candidate;
  }

  const direction = candidate >= fallback ? 1 : -1;
  const first_try = find_loop_selectable_index(items, candidate, direction);
  if (first_try !== -1) return first_try;

  const second_try = find_loop_selectable_index(items, candidate, direction * -1);
  if (second_try !== -1) return second_try;

  return candidate;
}

/**
 * 根据方向移动到下一个可选项，并在首尾之间循环。
 */
export function resolve_next_loop_selectable_index(
  items: readonly unknown[],
  current_index: number,
  direction: number,
): number {
  if (items.length <= 0) return 0;
  const step = direction < 0 ? -1 : 1;
  const start_index = normalize_index(current_index, items.length, 0);
  return find_loop_selectable_index(items, start_index + step, step, start_index);
}

/**
 * 判断列表项是否禁止选择。
 */
export function is_disabled_selectable_item(
  item: unknown,
): boolean {
  if (!item || typeof item !== "object") return false;
  return (item as { disabled?: unknown }).disabled === true;
}

function normalize_index(value: unknown, length: number, fallback: number): number {
  const index = typeof value === "number" && Number.isInteger(value) ? value : fallback;
  return wrap_index(index, length);
}

function wrap_index(index: number, length: number): number {
  if (length <= 0) return 0;
  return ((index % length) + length) % length;
}

function find_loop_selectable_index(
  items: readonly unknown[],
  start_index: number,
  direction: number,
  stop_index?: number,
): number {
  if (items.length <= 0) return -1;

  let index = wrap_index(start_index, items.length);
  for (let checked_count = 0; checked_count < items.length; checked_count += 1) {
    if (stop_index !== undefined && checked_count > 0 && index === stop_index) {
      break;
    }
    if (!is_disabled_selectable_item(items[index])) {
      return index;
    }
    index = wrap_index(index + direction, items.length);
  }

  return -1;
}
