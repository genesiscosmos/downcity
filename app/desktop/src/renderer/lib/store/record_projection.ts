/** Renderer Record 不可变投影的公共纯函数。 */

/** 移除任意指定前缀命中的键；没有命中时保留原 Record 引用。 */
export function remove_record_prefixes<Value>(current: Record<string, Value>, prefixes: readonly string[]): Record<string, Value> {
  const matching_keys = Object.keys(current).filter((key) => prefixes.some((prefix) => key.startsWith(prefix)));
  if (matching_keys.length === 0) return current;
  const next = { ...current };
  for (const key of matching_keys) delete next[key];
  return next;
}
