/**
 * 源码视图的语言识别。
 *
 * 只负责回答「这个文件用哪种语法」，不依赖 Shiki：语言标识是一个受约束的联合类型，
 * 语法加载器在 workspace_code_highlighter.ts 里按同一份标识表实现，两边由类型系统保证一致。
 *
 * 未识别的文件返回 undefined，源码视图按纯文本展示——仍然可读，只是没有着色。
 */

/**
 * 支持着色的语言。
 *
 * 这是一份人工维护的白名单：每新增一项，都必须在 workspace_code_highlighter.ts 中补上
 * 对应的语法加载器，否则类型检查会失败。不追求覆盖一切，只覆盖常见语言；
 * 语法文件是懒加载的，因此白名单的长度不直接等于首屏成本。
 */
export const supported_languages = [
  "c",
  "cmake",
  "cpp",
  "csharp",
  "css",
  "dockerfile",
  "go",
  "graphql",
  "html",
  "ini",
  "java",
  "javascript",
  "json",
  "jsonc",
  "jsx",
  "kotlin",
  "less",
  "lua",
  "makefile",
  "markdown",
  "mdx",
  "perl",
  "php",
  "powershell",
  "proto",
  "python",
  "ruby",
  "rust",
  "sass",
  "scss",
  "shellscript",
  "sql",
  "svelte",
  "swift",
  "toml",
  "tsx",
  "typescript",
  "vue",
  "xml",
  "yaml",
] as const;

/** 可着色的语言标识。 */
export type WorkspaceLanguage = typeof supported_languages[number];

/** 扩展名到语言标识。键一律小写且不含点；写错的标识会在类型检查阶段暴露。 */
const extension_languages: Readonly<Record<string, WorkspaceLanguage>> = {
  c: "c",
  cc: "cpp",
  cmake: "cmake",
  cjs: "javascript",
  cpp: "cpp",
  cs: "csharp",
  css: "css",
  cxx: "cpp",
  go: "go",
  gql: "graphql",
  graphql: "graphql",
  h: "c",
  hpp: "cpp",
  htm: "html",
  html: "html",
  ini: "ini",
  java: "java",
  js: "javascript",
  json: "json",
  jsonc: "jsonc",
  jsx: "jsx",
  kt: "kotlin",
  kts: "kotlin",
  less: "less",
  lua: "lua",
  md: "markdown",
  mdx: "mdx",
  mjs: "javascript",
  mk: "makefile",
  php: "php",
  pl: "perl",
  proto: "proto",
  ps1: "powershell",
  py: "python",
  rb: "ruby",
  rs: "rust",
  sass: "sass",
  scss: "scss",
  sh: "shellscript",
  sql: "sql",
  svelte: "svelte",
  swift: "swift",
  toml: "toml",
  ts: "typescript",
  tsx: "tsx",
  vue: "vue",
  xml: "xml",
  yaml: "yaml",
  yml: "yaml",
  zsh: "shellscript",
};

/** 无扩展名或扩展名无意义、但靠文件名即可确定的文件。键为小写文件名。 */
const filename_languages: Readonly<Record<string, WorkspaceLanguage>> = {
  ".bash_profile": "shellscript",
  ".bashrc": "shellscript",
  ".zshrc": "shellscript",
  "cmakelists.txt": "cmake",
  dockerfile: "dockerfile",
  makefile: "makefile",
};

/**
 * 解析文件应使用的语言。
 *
 * 先按完整文件名匹配（`Dockerfile`、`Makefile` 这类靠名字识别），再取最后一个扩展名。
 * 文件名与扩展名都大小写不敏感。
 */
export function resolve_workspace_language(relative_path: string): WorkspaceLanguage | undefined {
  const filename = relative_path.replace(/\\/g, "/").split("/").pop()?.toLowerCase() ?? "";
  if (!filename) return undefined;
  const by_filename = filename_languages[filename];
  if (by_filename) return by_filename;
  const separator = filename.lastIndexOf(".");
  if (separator < 0) return undefined;
  return extension_languages[filename.slice(separator + 1)];
}
