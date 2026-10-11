/**
 * city agent chat TUI 附件类型。
 */

/** 本地附件路径转换结果。 */
export interface ChatAttachmentTagBuildResult {
  /** 已通过校验并生成的标准 `<file>` 标签。 */
  tags: string[];
  /** 无法识别或读取的附件错误提示。 */
  errors: string[];
}
