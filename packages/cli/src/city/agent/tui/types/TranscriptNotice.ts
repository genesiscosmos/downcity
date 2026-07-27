/**
 * Chat TUI 本地提示类型。
 *
 * 本地提示只表达尚未进入 Session 的 CLI 状态或基础设施错误；会话中的 User、
 * Assistant、Action 和 Error 内容始终直接使用 canonical SessionMessage。
 */

/** Chat TUI 可以插入消息流的本地提示。 */
export interface TranscriptNotice {
  /** 本地提示在当前 TUI 进程内的稳定标识。 */
  id: string;
  /** 本地提示的视觉语义。 */
  kind: "local-status" | "local-error";
  /** 提示用户读取的单段文本。 */
  text: string;
  /** 本地提示创建时间戳，单位为毫秒。 */
  created_at: number;
}
