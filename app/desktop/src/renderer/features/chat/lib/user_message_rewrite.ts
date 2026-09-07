/** 用户消息编辑提交方式的纯逻辑判断。 */

/**
 * 消息之后没有内容且当前 Session 可替换时直接继续；否则必须让用户明确
 * 选择保留分支或替换当前对话。
 */
export function resolve_user_message_rewrite(has_later_visible_message: boolean, can_replace_session: boolean): "replace" | "choose" {
  return !has_later_visible_message && can_replace_session ? "replace" : "choose";
}
