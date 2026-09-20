/** Workspace 文件预览类型识别与阅读模式规则。 */

/**
 * 文件内容的阅读模式。
 *
 * `preview` 是默认：Markdown 文档渲染成排版后的正文，其它文件只有源码一种形态。
 * `source` 是 Markdown 文档的备选形态，入口在文件操作菜单里——它不再是顶栏上的常驻控件，
 * 因为绝大多数阅读都发生在预览里，常驻切换栏等于给少数动作配一个永久占位。
 */
export type WorkspaceFileViewMode = "preview" | "source";

/** 判断文件是否应使用安全 Markdown 视图展示。 */
export function is_markdown_document(relative_path: string): boolean {
  return /\.(?:md|mdx)$/i.test(relative_path);
}

/**
 * 解析打开文件时的初始阅读模式。
 *
 * 带行号的链接指向**源码位置**（Agent 输出的 `path:line` 就是这种链接），
 * 落在预览里那一行会被排版隐藏，因此这类打开一律先进源码视图；用户随后可以自己切回预览。
 */
export function resolve_default_view_mode(relative_path: string, line?: number): WorkspaceFileViewMode {
  return is_markdown_document(relative_path) && !line ? "preview" : "source";
}
