/**
 * Composer 异步操作的写入目标。附件结果与发送收尾仅能应用于仍持有同一草稿生命周期的编辑器。
 * signal 在会话切换、宿主交接、外部全文恢复或发送接管时失效；同名会话重新打开也不能复活旧请求。
 * 这是应用结果的有效性校验，不承诺取消底层 FileReader 或 IPC 已开始的读取。
 */
import type { Editor } from "@tiptap/core";

/** 一次异步读取或提交捕获的不可变目标。 */
export interface EditorAsyncTarget {
  /** 发起操作的编辑器实例，结果不能写入之后创建或复用的其它实例。 */
  editor: Editor;
  /** 发起操作的完整会话草稿键，防止同一实例切换会话后被迟到结果修改。 */
  editor_key: string;
  /** 当前草稿生命周期信号；即使切换后又回到相同会话，已终止请求仍然失效。 */
  signal: AbortSignal;
}

/** 只检查目标身份与生命周期，不读取文档正文或修改编辑器。 */
export function is_current_editor_async_target(
  target: EditorAsyncTarget,
  current_editor: Editor | null,
  current_editor_key: string,
): boolean {
  return !target.signal.aborted
    && current_editor === target.editor
    && current_editor_key === target.editor_key
    && !target.editor.isDestroyed
    && target.editor.view.dom.isConnected
    && !target.editor.view.dom.closest("[inert]");
}
