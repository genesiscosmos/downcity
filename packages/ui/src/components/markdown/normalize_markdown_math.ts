/** MarkdownView Markdown 的 LaTeX 边界归一化：支持块公式与行内公式，保留代码源码。 */

const math_expression_pattern = /[=^_]|\\[a-zA-Z]+/;

/**
 * 清理被额外进行 Markdown 转义的 LaTeX 内容。
 *
 * 双反斜杠命令是额外转义的判据；仅在出现此类命令时还原命令、下标与分组，
 * 保留正常 LaTeX 中用于换行的双反斜杠以及表示集合边界的转义花括号。
 */
function normalize_math_expression(expression: string): string {
  const trimmed_expression = expression.trim();
  if (!/\\\\[a-zA-Z]+/.test(trimmed_expression)) return trimmed_expression;
  return trimmed_expression.replace(/\\\\(?=[a-zA-Z])|\\([_{}])/g, (_match, escaped_character: string | undefined) => escaped_character ?? "\\");
}

/** 转换正文中的 LaTeX 边界；块公式允许跨行，且独占 Markdown 行。 */
function normalize_math_text(markdown_text: string): string {
  return markdown_text
    .replace(/\\\[([\s\S]*?)\\\]/g, (_match, expression: string) => `\n\n$$\n${normalize_math_expression(expression)}\n$$\n\n`)
    // 显式 LaTeX 边界使用双美元行内语法，避免受金额消歧的单美元边界限制。
    .replace(/\\\(([^\n]*?)\\\)/g, (_match, expression: string) => `$$${normalize_math_expression(expression)}$$`)
    .replace(/^([ \t]*)\[([^\n\]]+)\]([ \t]*)$/gm, (match, leading: string, expression: string, trailing: string) => {
      if (!math_expression_pattern.test(expression)) return match;
      return `${leading}$${normalize_math_expression(expression)}$${trailing}`;
    });
}

/**
 * 将 LaTeX 的 `\\[...\\]`、`\\(...\\)` 转换为 Streamdown 支持的数学边界。
 *
 * 围栏代码和行内代码保留原文；尚未闭合的围栏也保留，避免流式输出期间改写源码。
 * 匹配器在每次调用时独立创建，防止全局正则的游标在不同消息间共享。
 */
export function normalize_markdown_math(markdown_text: string): string {
  const code_pattern = /^[ \t]{0,3}(`{3,}|~{3,})[^\n]*\n[\s\S]*?(?:^[ \t]{0,3}\1[ \t]*\r?$|(?![\s\S]))|(`+)[\s\S]*?\2(?!`)/gm;
  const normalized_parts: string[] = [];
  let current_offset = 0;

  for (const code_match of markdown_text.matchAll(code_pattern)) {
    const code_offset = code_match.index;
    normalized_parts.push(normalize_math_text(markdown_text.slice(current_offset, code_offset)), code_match[0]);
    current_offset = code_offset + code_match[0].length;
  }
  normalized_parts.push(normalize_math_text(markdown_text.slice(current_offset)));
  return normalized_parts.join("");
}
