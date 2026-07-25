/**
 * Memory Plugin 类型定义。
 *
 * 关键点（中文）
 * - MemoryPlugin 对 agent 暴露“记忆能力”，内部使用 LLM Wiki 方式组织知识。
 * - `wiki` 是整理后的知识层，`source` 是原始证据层，`working` 是会话局部层。
 * - LLM 能力只通过 constructor 注入，plugin 自身不绑定具体模型或服务。
 */

import type { JsonValue } from "@downcity/agent";

/**
 * 记忆来源类型。
 */
export type MemorySourceType = "wiki" | "source" | "working";

/**
 * 查询模式。
 *
 * 说明（中文）
 * - 当前实现直接扫描 Markdown 文件，不引入向量库或外部索引服务。
 */
export type MemorySearchMode = "scan";

/**
 * MemoryPlugin constructor 参数。
 */
export interface MemoryPluginOptions {
  /**
   * 把 session 或长文本 source 提炼为 wiki page 的函数。
   *
   * 说明（中文）：未传时 `digest` action 会做确定性落盘，不会调用模型。
   */
  digest?: MemoryDigestHandler;

  /**
   * 基于新证据修订某个 wiki page 的函数。
   *
   * 说明（中文）：未传时 `remember`/`revise` 会追加写入，不做 LLM 重写。
   */
  revise?: MemoryReviseHandler;
}

/**
 * digest handler。
 */
export type MemoryDigestHandler = (
  input: MemoryDigestHandlerInput,
) => Promise<MemoryDigestHandlerOutput | string>;

/**
 * revise handler。
 */
export type MemoryReviseHandler = (
  input: MemoryReviseHandlerInput,
) => Promise<MemoryReviseHandlerOutput | string>;

/**
 * digest handler 输入。
 */
export interface MemoryDigestHandlerInput {
  /**
   * 当前项目根目录。
   */
  rootPath: string;

  /**
   * 需要提炼的原始文本。
   */
  sourceText: string;

  /**
   * 原始文本来源路径（相对项目根目录）。
   */
  sourcePath: string;

  /**
   * 触发 digest 的 session id。
   */
  session_id?: string;

  /**
   * 当前 wiki index 内容，方便模型决定更新哪些页面。
   */
  wikiIndex: string;
}

/**
 * digest handler 输出。
 */
export interface MemoryDigestHandlerOutput {
  /**
   * 本次 digest 生成或更新的 wiki page。
   */
  pages: MemoryWikiPageDraft[];

  /**
   * 给调用方看的简短摘要。
   */
  summary?: string;
}

/**
 * revise handler 输入。
 */
export interface MemoryReviseHandlerInput {
  /**
   * 当前项目根目录。
   */
  rootPath: string;

  /**
   * 要修订的 wiki page 路径（相对项目根目录）。
   */
  path: string;

  /**
   * 当前 page 内容；文件不存在时为空字符串。
   */
  currentContent: string;

  /**
   * 修订指令。
   */
  instruction: string;

  /**
   * 新证据或需要合入的内容。
   */
  evidence: string;
}

/**
 * revise handler 输出。
 */
export interface MemoryReviseHandlerOutput {
  /**
   * 修订后的 wiki page 路径；未传时沿用输入 path。
   */
  path?: string;

  /**
   * 修订后的完整 Markdown 内容。
   */
  content: string;

  /**
   * 给调用方看的简短摘要。
   */
  summary?: string;
}

/**
 * 待写入 wiki 的页面草稿。
 */
export interface MemoryWikiPageDraft {
  /**
   * 目标路径；可传 `.downcity/memory/wiki/foo.md` 或 `foo.md`。
   */
  path?: string;

  /**
   * 页面标题。
   */
  title?: string;

  /**
   * 完整 Markdown 内容。
   */
  content: string;

  /**
   * 页面标签。
   */
  tags?: string[];
}

/**
 * 单条记忆检索结果。
 */
export interface MemorySearchResultItem {
  /**
   * 片段来源路径（相对项目根目录）。
   */
  path: string;

  /**
   * 片段起始行号（1-based）。
   */
  startLine: number;

  /**
   * 片段结束行号（1-based）。
   */
  endLine: number;

  /**
   * 归一化分数（0~1，越高越相关）。
   */
  score: number;

  /**
   * 返回给模型/用户的片段文本（已按预算裁剪）。
   */
  snippet: string;

  /**
   * 记忆来源分类。
   */
  source: MemorySourceType;

  /**
   * 引用标记（例如：`.downcity/memory/wiki/plugin-system.md#L12-L20`）。
   */
  citation: string;
}

/**
 * 记忆检索请求。
 */
export interface MemorySearchPayload {
  /**
   * 查询语句。
   */
  query: string;

  /**
   * 可选返回条数上限，未传使用内置默认值。
   */
  maxResults?: number;

  /**
   * 可选分数阈值，未传使用内置默认值。
   */
  minScore?: number;

  /**
   * 是否检索原始 source 层；默认只检索 wiki 层和 working 层。
   */
  includeSources?: boolean;
}

/**
 * 记忆检索响应。
 */
export interface MemorySearchResponse {
  /**
   * 返回结果集合。
   */
  results: MemorySearchResultItem[];

  /**
   * 当前检索模式。
   */
  mode: MemorySearchMode;

  /**
   * 当前后端标识。
   */
  backend: "builtin";

  /**
   * 错误原因文本（失败场景）。
   */
  error?: string;

  /**
   * 建议动作（失败场景）。
   */
  action?: string;
}

/**
 * 读取记忆片段请求。
 */
export interface MemoryReadPayload {
  /**
   * 相对项目根目录的目标路径。
   */
  path: string;

  /**
   * 可选起始行（1-based）。
   */
  from?: number;

  /**
   * 可选读取行数。
   */
  lines?: number;
}

/**
 * 读取记忆片段响应。
 */
export interface MemoryReadResponse {
  /**
   * 目标路径（回显）。
   */
  path: string;

  /**
   * 读取内容；文件缺失时为空字符串。
   */
  text: string;

  /**
   * 文件不存在时为 true。
   */
  missing?: boolean;
}

/**
 * remember 请求。
 */
export interface MemoryRememberPayload {
  /**
   * 需要记住的内容。
   */
  content: string;

  /**
   * 可选主题，用于决定默认 wiki page 路径。
   */
  topic?: string;

  /**
   * 可选目标 wiki page 路径。
   */
  path?: string;

  /**
   * 可选来源说明。
   */
  source?: string;
}

/**
 * remember 响应。
 */
export interface MemoryRememberResponse {
  /**
   * 原始 source 归档路径。
   */
  sourcePath: string;

  /**
   * 写入或更新的 wiki page 路径。
   */
  wikiPath: string;

  /**
   * 当前写入策略。
   */
  mode: "appended" | "revised";

  /**
   * 写入内容字符数。
   */
  writtenChars: number;

  /**
   * 可选摘要。
   */
  summary?: string;
}

/**
 * digest 请求。
 */
export interface MemoryDigestPayload {
  /**
   * 目标 session id。
   */
  session_id: string;

  /**
   * 可选最大提取消息条数。
   */
  maxMessages?: number;
}

/**
 * digest 响应。
 */
export interface MemoryDigestResponse {
  /**
   * 原始 session source 归档路径。
   */
  sourcePath: string;

  /**
   * 写入或更新的 wiki page 路径集合。
   */
  wikiPaths: string[];

  /**
   * 参与 digest 的消息条数。
   */
  message_count: number;

  /**
   * 当前 digest 模式。
   */
  mode: "archived" | "digested";

  /**
   * 可选摘要。
   */
  summary?: string;
}

/**
 * revise 请求。
 */
export interface MemoryRevisePayload {
  /**
   * 要修订的 wiki page 路径。
   */
  path: string;

  /**
   * 修订指令。
   */
  instruction: string;

  /**
   * 新证据或需要合入的内容。
   */
  evidence?: string;
}

/**
 * revise 响应。
 */
export interface MemoryReviseResponse {
  /**
   * 实际写入的 wiki page 路径。
   */
  path: string;

  /**
   * 当前 revise 模式。
   */
  mode: "appended" | "revised";

  /**
   * 写入内容字符数。
   */
  writtenChars: number;

  /**
   * 可选摘要。
   */
  summary?: string;
}

/**
 * 按来源统计。
 */
export interface MemorySourceStat {
  /**
   * 来源分类。
   */
  source: MemorySourceType;

  /**
   * 文件数量。
   */
  files: number;

  /**
   * 片段数量。
   */
  chunks: number;
}

/**
 * status 返回结构。
 */
export interface MemoryStatusResponse {
  /**
   * 后端标识。
   */
  backend: "builtin";

  /**
   * 当前检索模式。
   */
  mode: MemorySearchMode;

  /**
   * 文件总数。
   */
  files: number;

  /**
   * chunk 总数。
   */
  chunks: number;

  /**
   * 按来源统计。
   */
  sourceCounts: MemorySourceStat[];
}

/**
 * Memory service 内置默认配置。
 */
export interface MemoryDefaults {
  /**
   * 检索默认返回条数。
   */
  maxResults: number;

  /**
   * 检索默认最小分数。
   */
  minScore: number;

  /**
   * 注入预算（字符）。
   */
  maxInjectedChars: number;
}

/**
 * Memory action payload 联合。
 */
export type MemoryActionPayload =
  | MemorySearchPayload
  | MemoryReadPayload
  | MemoryRememberPayload
  | MemoryDigestPayload
  | MemoryRevisePayload
  | Record<string, JsonValue>;
