/**
 * canonical 输入的轻量版本投影。只包含稳定身份、内容摘要及附件引用，
 * 正文由存储拥有者读取和摘要，不跨 Worker 传输到模型控制线程。
 */

/** 一条 canonical Message 中参与模型输入一致性校验的内容版本。 */
export interface SessionInputMessageVersion {
  /** 原始 Message 的稳定身份；不存在时不能恢复依赖它的步骤。 */
  message_id: string;
  /** 参与输入的 Parts；后续追加 Part 不改变已有版本的有效性。 */
  parts: Array<{
    /** 原始 Part 的稳定身份。 */
    part_id: string;
    /** 存储中 Part 的身份、顺序、类型及原始内容编码的 SHA-256。 */
    sha256: string;
  }>;
}

/** 在一次存储读事务中取得的 Session 输入校验事实。 */
export interface SessionInputVersions {
  /** 排除 error/data/action 后的 canonical 内容版本，不携带正文。 */
  messages: SessionInputMessageVersion[];
  /** 已登记内容中的本地文件路径，去重并保持首次出现顺序。 */
  attachment_paths: string[];
  /** canonical Tool 中是否仍存在等待响应的 Interaction。 */
  has_pending_interactions: boolean;
}
