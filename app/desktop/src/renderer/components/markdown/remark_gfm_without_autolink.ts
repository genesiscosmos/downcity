/** 保留 GFM 常用语法、移除病态自动链接解析的 remark 插件。 */

import { combineExtensions } from "micromark-util-combine-extensions";
import { gfmFootnote } from "micromark-extension-gfm-footnote";
import { gfmStrikethrough } from "micromark-extension-gfm-strikethrough";
import { gfmTable } from "micromark-extension-gfm-table";
import { gfmTaskListItem } from "micromark-extension-gfm-task-list-item";
import { gfmFootnoteFromMarkdown } from "mdast-util-gfm-footnote";
import { gfmStrikethroughFromMarkdown } from "mdast-util-gfm-strikethrough";
import { gfmTableFromMarkdown } from "mdast-util-gfm-table";
import { gfmTaskListItemFromMarkdown } from "mdast-util-gfm-task-list-item";

/** remark-parse 在 Processor data 上读取的扩展集合。 */
interface MarkdownParserData {
  /** unified 共享设置；用于保证该结构可赋值给内置 Processor 的 data 返回值。 */
  settings?: unknown;
  /** micromark 语法扩展。 */
  micromarkExtensions?: ReturnType<typeof combineExtensions>[];
  /** micromark 语法到 mdast 节点的转换扩展。 */
  fromMarkdownExtensions?: ReturnType<typeof gfmFootnoteFromMarkdown>[];
}

/**
 * 注册除自动链接外的全部常用 GFM 语法。
 *
 * `remark-gfm` 固定包含 `gfmAutolinkLiteral`，该扩展在超长单行文本上近似 O(n²)，
 * 会让 Renderer 主线程卡死。这里显式组合脚注、删除线、表格和任务列表，保留用户常用的
 * GFM 能力；标准 Markdown 链接不受影响，裸 URL 不再自动生成链接。
 */
export function remark_gfm_without_autolink(this: { data(): MarkdownParserData }): undefined {
  const data = this.data();
  const micromark_extensions = data.micromarkExtensions ?? (data.micromarkExtensions = []);
  const from_markdown_extensions = data.fromMarkdownExtensions ?? (data.fromMarkdownExtensions = []);

  micromark_extensions.push(combineExtensions([
    gfmFootnote(),
    gfmStrikethrough(),
    gfmTable(),
    gfmTaskListItem(),
  ]));
  from_markdown_extensions.push(
    gfmFootnoteFromMarkdown(),
    gfmStrikethroughFromMarkdown(),
    gfmTableFromMarkdown(),
    gfmTaskListItemFromMarkdown(),
  );
}
