/** 文件详情的公开语言识别；宿主不需要提供文件读取或执行能力。 */
const file_languages: Readonly<Record<string, string>> = {
  ts: "typescript", tsx: "tsx", js: "javascript", jsx: "jsx", mjs: "javascript", cjs: "javascript",
  json: "json", md: "markdown", mdx: "mdx", css: "css", html: "html", py: "python", sh: "bash",
  yaml: "yaml", yml: "yaml", toml: "toml", rs: "rust", go: "go", sql: "sql", svg: "xml",
};
/** 未知扩展名保持原始文本，不猜测内容。 */
export function activity_file_language(path: string): string | undefined {
  return file_languages[path.split(".").pop()?.toLowerCase() ?? ""];
}
