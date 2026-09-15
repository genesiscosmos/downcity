/**
 * Workspace 源码视图的语法高亮。
 *
 * 用 Shiki（与 Markdown 代码块同一个引擎与同一套配色）把文件切成按行分组的着色片段。
 * 之所以自己调用而不用 Markdown 渲染器：源码视图需要逐行 DOM，才能定位并高亮某一行，
 * 这里输出的分组结构正好与那一层需求对应。
 *
 * 四个取舍：
 * 1. **整篇着色，不逐行着色。** 逐行会切断块注释、模板字符串的语法作用域，颜色会出错。
 *    因此按整篇取 token 再按行装配。
 * 2. **明暗两套主题一并产出。** 片段上同时带浅色 `color` 与 `--shiki-dark` 变量，
 *    由样式表在 `.dark` 下切换；与 Markdown 代码块的做法一致，切换主题不需要重新着色。
 * 3. **语法按需加载。** 高亮器只预载主题与引擎，语言在首次遇到该类型文件时才拉取并编译，
 *    因此支持的语言数量不构成首屏成本；引擎用 JavaScript 正则实现，不需要 wasm 资源。
 * 4. **失败一律降级为纯文本。** 语法加载失败或 token 行数与文本行数不一致时返回 undefined，
 *    由调用方按无高亮渲染——宁可不着色，也不能让行号与内容错位。
 */

import { createHighlighterCore, type HighlighterCore, type LanguageInput } from "shiki/core";
import { createJavaScriptRegexEngine } from "shiki/engine/javascript";
import github_dark from "shiki/themes/github-dark.mjs";
import github_light from "shiki/themes/github-light.mjs";
import type { WorkspaceLanguage } from "./workspace_file_language";

/** 一个着色片段。 */
export interface HighlightedToken {
  /** 片段原文。 */
  content: string;
  /**
   * 内联到 span 上的样式。
   *
   * 含浅色 `color` 与深色变量；深色取值由样式表在 `.dark` 下以 `!important` 覆盖，
   * 因为内联样式无法被普通声明改写。
   */
  style?: Record<string, string>;
}

/**
 * 每种语言对应的语法加载器。
 *
 * 必须覆盖 `supported_languages` 的全部取值：漏掉一种会在类型检查阶段报错，
 * 因此这里与 language 模块不需要额外的一致性测试。
 */
const language_loaders: Readonly<Record<WorkspaceLanguage, () => Promise<LanguageInput>>> = {
  c: () => import("shiki/langs/c.mjs").then((module) => module.default),
  cmake: () => import("shiki/langs/cmake.mjs").then((module) => module.default),
  cpp: () => import("shiki/langs/cpp.mjs").then((module) => module.default),
  csharp: () => import("shiki/langs/csharp.mjs").then((module) => module.default),
  css: () => import("shiki/langs/css.mjs").then((module) => module.default),
  dockerfile: () => import("shiki/langs/dockerfile.mjs").then((module) => module.default),
  go: () => import("shiki/langs/go.mjs").then((module) => module.default),
  graphql: () => import("shiki/langs/graphql.mjs").then((module) => module.default),
  html: () => import("shiki/langs/html.mjs").then((module) => module.default),
  ini: () => import("shiki/langs/ini.mjs").then((module) => module.default),
  java: () => import("shiki/langs/java.mjs").then((module) => module.default),
  javascript: () => import("shiki/langs/javascript.mjs").then((module) => module.default),
  json: () => import("shiki/langs/json.mjs").then((module) => module.default),
  jsonc: () => import("shiki/langs/jsonc.mjs").then((module) => module.default),
  jsx: () => import("shiki/langs/jsx.mjs").then((module) => module.default),
  kotlin: () => import("shiki/langs/kotlin.mjs").then((module) => module.default),
  less: () => import("shiki/langs/less.mjs").then((module) => module.default),
  lua: () => import("shiki/langs/lua.mjs").then((module) => module.default),
  makefile: () => import("shiki/langs/makefile.mjs").then((module) => module.default),
  markdown: () => import("shiki/langs/markdown.mjs").then((module) => module.default),
  mdx: () => import("shiki/langs/mdx.mjs").then((module) => module.default),
  perl: () => import("shiki/langs/perl.mjs").then((module) => module.default),
  php: () => import("shiki/langs/php.mjs").then((module) => module.default),
  powershell: () => import("shiki/langs/powershell.mjs").then((module) => module.default),
  proto: () => import("shiki/langs/proto.mjs").then((module) => module.default),
  python: () => import("shiki/langs/python.mjs").then((module) => module.default),
  ruby: () => import("shiki/langs/ruby.mjs").then((module) => module.default),
  rust: () => import("shiki/langs/rust.mjs").then((module) => module.default),
  sass: () => import("shiki/langs/sass.mjs").then((module) => module.default),
  scss: () => import("shiki/langs/scss.mjs").then((module) => module.default),
  shellscript: () => import("shiki/langs/shellscript.mjs").then((module) => module.default),
  sql: () => import("shiki/langs/sql.mjs").then((module) => module.default),
  svelte: () => import("shiki/langs/svelte.mjs").then((module) => module.default),
  swift: () => import("shiki/langs/swift.mjs").then((module) => module.default),
  toml: () => import("shiki/langs/toml.mjs").then((module) => module.default),
  tsx: () => import("shiki/langs/tsx.mjs").then((module) => module.default),
  typescript: () => import("shiki/langs/typescript.mjs").then((module) => module.default),
  vue: () => import("shiki/langs/vue.mjs").then((module) => module.default),
  xml: () => import("shiki/langs/xml.mjs").then((module) => module.default),
  yaml: () => import("shiki/langs/yaml.mjs").then((module) => module.default),
};

/** 浅色与深色主题；与 Markdown 代码块保持同一套配色。 */
const light_theme = "github-light";
const dark_theme = "github-dark";

/**
 * 超过此字符数就不着色。
 *
 * 预览上限是 2 MB，但着色的开销远大于渲染纯文本，且发生在主线程：
 * 命中小概率的大文件会茷住界面。宁可对超大文件退回纯文本。
 */
const highlight_max_characters = 400_000;

/** 进程内共享的高亮器；引擎与语法编译开销大，必须复用。 */
let highlighter_promise: Promise<HighlighterCore> | undefined;

/** 已完成加载的语言，避免重复 import。 */
const loaded_languages = new Set<WorkspaceLanguage>();

/** 惰性创建高亮器，只预载主题与引擎。 */
function get_highlighter(): Promise<HighlighterCore> {
  highlighter_promise ??= createHighlighterCore({
    themes: [github_light, github_dark],
    langs: [],
    // 用 JavaScript 正则引擎而不是 oniguruma：后者要加载 wasm 资源，在 Electron 渲染进程里
    // 既要处理资源路径又要在运行时解码 600 KB wasm；Markdown 代码块用的也是这套引擎。
    // forgiving 让个别语法中 JS 引擎不支持的规则降级处理，而不是整篇报错。
    engine: createJavaScriptRegexEngine({ forgiving: true }),
  }).catch((reason: unknown) => {
    // 创建失败（例如 wasm 异常）时清掉缓存，下次打开文件可以重新尝试，而不是整个会话都无法着色。
    highlighter_promise = undefined;
    throw reason;
  });
  return highlighter_promise;
}

/** 确保某种语言的语法已加载。 */
async function ensure_language(highlighter: HighlighterCore, language: WorkspaceLanguage): Promise<void> {
  if (loaded_languages.has(language)) return;
  await highlighter.loadLanguage(await language_loaders[language]());
  loaded_languages.add(language);
}

/**
 * 把源码着色为按行分组的片段。
 *
 * `expected_line_count` 是调用方即将渲染的行数，按 `split("\n")` 的原样行数计（含末尾空行）。
 * 只有 token 行数与之一致时才返回结果，否则返回 undefined，避免行号与内容错位。
 */
export async function highlight_code_lines(code: string, language: WorkspaceLanguage, expected_line_count: number): Promise<HighlightedToken[][] | undefined> {
  if (!code || expected_line_count <= 0 || code.length > highlight_max_characters) return undefined;
  try {
    const highlighter = await get_highlighter();
    await ensure_language(highlighter, language);
    const result = highlighter.codeToTokens(code, {
      lang: language,
      themes: { light: light_theme, dark: dark_theme },
    });
    if (result.tokens.length !== expected_line_count) return undefined;
    return result.tokens.map((line) => line.map((token) => ({
      content: token.content,
      ...(token.htmlStyle ? { style: token.htmlStyle } : {}),
    })));
  } catch {
    return undefined;
  }
}
