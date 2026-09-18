/**
 * Chat 运行时注入的 User Context Tag 保留区。
 *
 * 运行时（当前是 Chat Power）会把「本轮请求的事实」作为 context part 写入 user message：
 * 一条描述用户与消息元信息，一条描述 chat 路由环境。它们描述消息本身的来源与环境，
 * 不代表用户撰写的内容。
 *
 * 消费方（Desktop 消息渲染、Composer 回填）据此区分「系统注入」与「用户撰写」，
 * 避免把运行时事实当成用户输入展示、或在下一次提交时原样带回。
 *
 * 注意（中文）
 * - tag 名由 Chat Power 的生产端与 Desktop 的消费端共同依赖，因此在这里定义唯一来源。
 * - 这些 tag 属于保留区，业务侧不应把用户撰写的内容写成同名 tag。
 */

/** 记录本轮用户与消息元信息的 context tag。 */
export const CHAT_INFO_CONTEXT_TAG = "info";

/** 记录本轮 chat 路由环境的 context tag。 */
export const CHAT_ENVIRONMENT_CONTEXT_TAG = "chat-environment";

/** 由 Chat 运行时注入、不代表用户输入的全部 user context tag。 */
export const CHAT_RUNTIME_CONTEXT_TAGS = [
  CHAT_INFO_CONTEXT_TAG,
  CHAT_ENVIRONMENT_CONTEXT_TAG,
] as const;

/** Chat 运行时注入的 user context tag。 */
export type ChatRuntimeContextTag = (typeof CHAT_RUNTIME_CONTEXT_TAGS)[number];

/** 判断一个 context tag 是否由 Chat 运行时注入。 */
export function is_chat_runtime_context_tag(tag: unknown): boolean {
  if (typeof tag !== "string") return false;
  return (CHAT_RUNTIME_CONTEXT_TAGS as readonly string[]).includes(tag);
}
