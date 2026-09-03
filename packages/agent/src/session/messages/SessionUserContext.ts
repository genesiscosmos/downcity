/**
 * Session User Context Part 的校验与模型标记渲染。
 *
 * canonical Message 始终保存原始 tag 与 context；只有进入模型上下文时才生成 XML 风格标记，
 * 避免持久化层与具体模型提示格式互相耦合。
 */

/** Session Context 标签允许使用的稳定名称格式。 */
const SESSION_CONTEXT_TAG_PATTERN = /^[a-z][a-z0-9_-]*$/u;

/** 校验并规范化 Session Context 标签。 */
export function normalize_session_context_tag(tag_input: unknown): string {
  const tag = typeof tag_input === "string" ? tag_input.trim() : "";
  if (!SESSION_CONTEXT_TAG_PATTERN.test(tag)) {
    throw new Error(
      "Session context tag must start with a lowercase letter and contain only lowercase letters, numbers, underscores, or hyphens",
    );
  }
  return tag;
}

/** 校验 Session Context 正文，同时保留调用方提供的原始空白。 */
export function normalize_session_context_content(context_input: unknown): string {
  const context = typeof context_input === "string" ? context_input : "";
  if (!context.trim()) {
    throw new Error("Session context content must not be empty");
  }
  return context;
}

/** 把 canonical Context Part 安全渲染为模型可消费的 XML 风格文本。 */
export function render_session_user_context(
  tag_input: unknown,
  context_input: unknown,
): string {
  const tag = normalize_session_context_tag(tag_input);
  const context = normalize_session_context_content(context_input);
  return `<${tag}>${escape_xml_text(context)}</${tag}>`;
}

/** 转义 XML 文本节点中的结构字符，防止正文提前闭合或插入标签。 */
function escape_xml_text(value: string): string {
  return value
    .replace(/&/gu, "&amp;")
    .replace(/</gu, "&lt;")
    .replace(/>/gu, "&gt;");
}
