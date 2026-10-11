/**
 * Control Session Execute API 类型定义。
 *
 * 关键点（中文）
 * - 统一描述 `/api/control/sessions/:session_id/execute` 的扩展请求体。
 * - 支持通过 API 传入附件（路径或内容），由服务端落盘后注入 `<file>` 标签。
 */

/**
 * Control execute 附件类型。
 */
export type ControlSessionExecuteAttachmentType =
  | "document"
  | "photo"
  | "voice"
  | "audio"
  | "video";

/**
 * Control execute 单个附件入参。
 */
export interface ControlSessionExecuteAttachmentInput {
  /**
   * 附件类型。
   *
   * 说明（中文）
   * - 默认按 `document` 处理。
   * - 会映射为 `<file type="...">...</file>`。
   */
  type?: ControlSessionExecuteAttachmentType | string;

  /**
   * 附件相对路径（相对项目根目录）。
   *
   * 说明（中文）
   * - 当该字段存在时，服务端优先复用该路径。
   * - 仅允许项目目录内路径；越界路径会被忽略。
   */
  path?: string;

  /**
   * 附件文件名（用于服务端落盘命名）。
   *
   * 说明（中文）
   * - 当通过 `content/contentBase64` 上传附件内容时生效。
   */
  fileName?: string;

  /**
   * 附件说明（可选）。
   *
   * 说明（中文）
   * - 会映射到 `<file caption="...">`。
   */
  caption?: string;

  /**
   * 文本内容（UTF-8）。
   *
   * 说明（中文）
   * - 常用于 Markdown 文档直传。
   * - 与 `contentBase64` 二选一，优先使用 `content`。
   */
  content?: string;

  /**
   * 二进制内容（Base64 编码）。
   *
   * 说明（中文）
   * - 当附件不是纯文本时可使用该字段。
   */
  contentBase64?: string;

  /**
   * MIME 类型（可选）。
   *
   * 说明（中文）
   * - 仅用于推断落盘扩展名，不参与权限判断。
   */
  contentType?: string;
}

/**
 * Control execute 请求体。
 */
export interface ControlSessionExecuteRequestBody {
  /**
   * 用户自然语言指令。
   */
  instructions: string;

  /**
   * 附件列表（可选）。
   *
   * 说明（中文）
   * - 服务端会将附件落盘后，自动把 `<file>` 标签注入到 user message 顶部。
   */
  attachments?: ControlSessionExecuteAttachmentInput[];
}
