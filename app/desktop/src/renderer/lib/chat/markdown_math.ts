/** Desktop Chat Markdown 的数学公式边界兼容处理。 */

const math_expression_pattern = /[=^_]|\\[a-zA-Z]+/;

/** 将常见的 LaTeX 方括号边界转换为 Streamdown 支持的行内公式边界。 */
export function normalize_markdown_math(markdown_text: string): string {
  const normalized_text = markdown_text
    .replace(/\\\[([^\n]*?)\\\]/g, (_match, expression: string) => `$${expression.trim()}$`)
    .replace(/^(\s*)\[([^\n\]]+)\](\s*)$/gm, (match, leading: string, expression: string, trailing: string) => {
      if (!math_expression_pattern.test(expression)) return match;
      return `${leading}$${expression.trim()}$${trailing}`;
    });

  return normalized_text;
}
