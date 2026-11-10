/** Markdown 渲染前的输入保护。 */

/** Markdown 单条内容允许解析的最大字符数。 */
export const MARKDOWN_MAX_CHARACTERS = 128 * 1024;

/** Markdown 单行允许解析的最大字符数。 */
export const MARKDOWN_MAX_LINE_CHARACTERS = 64 * 1024;

/**
 * 判断 Markdown 是否应降级为纯文本。
 *
 * Markdown 解析发生在 Renderer 主线程，异常超长内容可能让界面长时间无响应。这里只做线性
 * 扫描，不按换行符拆分字符串，避免保护逻辑自己制造额外的大数组。
 */
export function exceeds_markdown_limits(text: string): boolean {
  if (text.length > MARKDOWN_MAX_CHARACTERS) return true;

  let line_length = 0;
  for (let index = 0; index < text.length; index += 1) {
    if (text.charCodeAt(index) === 10) {
      line_length = 0;
      continue;
    }

    line_length += 1;
    if (line_length > MARKDOWN_MAX_LINE_CHARACTERS) return true;
  }

  return false;
}
