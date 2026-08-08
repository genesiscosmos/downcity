/**
 * Session 附件持久化能力。
 *
 * Session Message 只保存附件引用，附件内容由该 Store 在 Session 生命周期内持有。
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
