/** 用户消息编辑提交方式的纯逻辑判断。 */

/**
 * 最后一条消息可以直接替换当前 Session；历史消息必须先让用户选择
 * 保留分支或删除后续消息。
 */
export function resolve_user_message_rewrite(is_last_message: boolean): "rollback" | "choose" {
  return is_last_message ? "rollback" : "choose";
}
