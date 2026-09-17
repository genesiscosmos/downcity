/**
 * 新建对话触发的输入聚焦意图。
 *
 * Desktop 在新建对话后必须把键盘焦点交给新对话的输入框，但输入框是随后才挂载的：
 * 这里用按 Chat 组合键递增的请求序号表达意图，编辑器在挂载时或收到更大序号时聚焦一次。
 * 序号只增不减，所以同一对话重复请求仍然生效，而组件重渲染不会重复聚焦。
 */

/** 记录一次聚焦请求；同一对话再次请求会得到更大的序号。 */
export function request_composer_focus(current: Record<string, number>, session_key: string): Record<string, number> {
  return { ...current, [session_key]: read_composer_focus_request(current, session_key) + 1 };
}

/** 读取指定对话当前的聚焦请求序号；从未请求过时为 0。 */
export function read_composer_focus_request(current: Record<string, number>, session_key: string): number {
  return current[session_key] ?? 0;
}

/** 判断编辑器是否应该因为该请求获得焦点：只有尚未处理过的正序号才生效。 */
export function should_apply_composer_focus(request: number, applied_request: number): boolean {
  return request > 0 && request !== applied_request;
}
