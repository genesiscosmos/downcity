/** ResultRef v2 的永久会话来源协议；引用定位内容，不授予跨 Agent 读取权限。 */

/** canonical Tool Part 的不可变位置；会话身份独立于归档状态。 */
export interface ResultLocation {
  /** 来源会话的永久 UUIDv4，不能使用 Agent ID 或历史逻辑地址。 */
  session_id: string;
  /** 来源消息稳定 ID；fork 重新分配消息 ID，并保留原结果引用。 */
  message_id: string;
  /** 来源消息的正整数序号，允许精确有界读取。 */
  message_sequence: number;
  /** canonical Tool Part 的稳定 ID，与执行调用 ID 分离。 */
  part_id: string;
  /** 可选来源分类一致性校验；不能扩大会话身份命名空间。 */
  category?: string;
}

/** 已发布结果的定位和内容摘要，前缀 res_2_ 固定协议版本。 */
export interface ResultSnapshot extends ResultLocation {
  /** 稳定阅读值的 SHA-256 base64url 摘要，拒绝内容变化。 */
  digest: string;
}
