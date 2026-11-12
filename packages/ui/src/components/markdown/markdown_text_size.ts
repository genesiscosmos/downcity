/** Markdown 的受控字号档位；宿主输入框可读取同一组 rem 值以保持对话尺度一致。 */

/** 受控阅读字号；compact 用于过程详情，不接受任意数字或 CSS 字符串。 */
export type MarkdownViewTextSize = "compact" | "small" | "medium" | "large" | "extra_large";

/** 档位值仅在组件内部定义，均随根字号缩放。 */
const text_sizes: Readonly<Record<MarkdownViewTextSize, string>> = {
  compact: "0.6875rem",
  small: "0.8125rem",
  medium: "0.875rem",
  large: "0.9375rem",
  extra_large: "1rem",
};

/** 将受控档位解析为字号；运行时无效输入收敛到标准档。 */
export function get_markdown_text_size(text_size: MarkdownViewTextSize): string {
  return Object.hasOwn(text_sizes, text_size) ? text_sizes[text_size] : text_sizes.medium;
}

/** 上下文仅保存合法档位，避免无效 data 属性与实际字号不一致。 */
export function normalize_markdown_text_size(text_size: MarkdownViewTextSize): MarkdownViewTextSize {
  return Object.hasOwn(text_sizes, text_size) ? text_size : "medium";
}
