/** Chat 输入草稿在本地编辑器与 composer store 之间同步时使用的判定规则。 */

import type { JSONContent } from "@tiptap/core";

/**
 * 判断外部草稿是否需要写入当前 Tiptap 编辑器。
 *
 * 同一输入目标刚完成本地回写时复用编辑器文档；输入目标变化时必须重新加载，
 * 即使目标草稿恰好仍是上一次发布到 store 的对象。
 */
export function should_restore_editor_draft(
  loaded_editor_key: string,
  next_editor_key: string,
  external_draft: JSONContent,
  locally_published_draft?: JSONContent,
): boolean {
  return loaded_editor_key !== next_editor_key || external_draft !== locally_published_draft;
}
