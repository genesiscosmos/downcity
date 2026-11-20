/** Session 精确元数据查询；只读已有记录，不恢复执行器或枚举目录。 */
import type { SessionHistoryMeta } from "../store/SessionHistoryMeta.js";

/** 精确记录 UUID 优先；无 UUID 时只允许查询当前活动逻辑地址。 */
export interface SessionMetadataAddress {
  /** 可选的 Session 类型一致性校验，不参与 UUID 身份。 */
  type?: string;
  /** 分类内逻辑会话标识，不能用于猜测归档记录。 */
  session_id: string;
}

/** 一条已有记录的小字段快照，不包含消息或执行配置。 */
export interface SessionMetadataResult {
  /** 元数据所属会话的永久 UUID。 */
  session_id: string;
  /** 当前归档状态。 */
  archived: boolean;
  /** 当前目录元数据。 */
  metadata: SessionHistoryMeta;
}
