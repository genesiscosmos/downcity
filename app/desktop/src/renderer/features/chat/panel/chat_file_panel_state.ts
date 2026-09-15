/**
 * Chat 侧栏「文件」域的持久化状态。
 *
 * 侧栏里打开的文件属于该 Chat 的视图状态，按 `view_key` 隔离存储，
 * 与 BayBar 记忆当前域/分区的做法一致：切回同一个对话或刷新后仍在原处。
 * 这里只放可序列化的读取与校验，UI 状态本身由 ChatFilePanel 持有。
 */

/** Chat 侧栏当前打开的文件。 */
export interface ChatPanelFile {
  /** Workspace 内相对文件路径。 */
  relative_path: string;
  /** 需要滚动并高亮的 1 基行号；链接未标注行号时省略。 */
  line?: number;
}

/** 某个 Chat 视图的文件面板存储键。 */
export function chat_file_panel_storage_key(view_key: string): string {
  return `downcity.chat_file_panel:${view_key}`;
}

/** 序列化侧栏文件状态。 */
export function format_chat_panel_file(file: ChatPanelFile): string {
  return JSON.stringify(file);
}

/** 从持久化字符串还原侧栏文件状态；结构不合法时返回 undefined，面板回到空态。 */
export function parse_chat_panel_file(serialized: string | null): ChatPanelFile | undefined {
  if (!serialized) return undefined;
  try {
    const value: unknown = JSON.parse(serialized);
    if (typeof value !== "object" || value === null) return undefined;
    const candidate = value as Record<string, unknown>;
    if (typeof candidate.relative_path !== "string" || !candidate.relative_path) return undefined;
    return {
      relative_path: candidate.relative_path,
      ...(is_positive_integer(candidate.line) ? { line: candidate.line } : {}),
    };
  } catch {
    return undefined;
  }
}

/** 判断未知值是否为正整数行号。 */
function is_positive_integer(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}
