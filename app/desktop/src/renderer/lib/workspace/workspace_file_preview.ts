/** Workspace 文件预览类型识别规则。 */

/** 判断文件是否应使用安全 Markdown 视图展示。 */
export function is_markdown_document(relative_path: string): boolean {
  return /\.(?:md|mdx)$/i.test(relative_path);
}
