/**
 * Session 附件持久化能力。
 *
 * Session Message 只保存附件引用，附件内容由该 Store 在 Session 生命周期内持有。
 *
 * 数据边界（中文）：
 * - 输入边界：`session.prompt()` 接收 `type: "file"`、`mediaType` 和 Data URL。
 * - 存储边界：Store 解码 Data URL，写入 `.downcity/.../attachments/att_<id>.<ext>`。
 * - Message 边界：Session Message 只记录相对 Workspace 根目录的附件路径。
 * - 模型边界：模型转换器读取该路径，在内存中恢复成模型需要的文件内容。
 *
 * 因此，Data URL 不会直接进入 JSONL Message；Session Message 是附件路径的唯一引用。
 */

/** 可持久化的 Data URL 附件。 */
export interface SessionAttachmentStore {
  /**
   * 保存 Data URL，并返回相对 Workspace 根目录的稳定文件路径。
   * 调用成功后，返回路径对应的附件文件必须已经完整落盘。
   */
  persist_data_url(input: {
    /** 完整的 Data URL。 */
    data_url: string;
    /** 调用侧声明的 MIME 类型。 */
    media_type: string;
    /** 可选的原始文件名，仅用于推导扩展名。 */
    filename?: string;
  }): Promise<string>;
}
