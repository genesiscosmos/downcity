/** 归档只读视图的线协议快照，不携带执行器或写能力。 */
import type { SessionHistoryMeta } from "./SessionHistoryMeta.js";

/** 归档详情独立于消息/大配置水合。 */
export interface SessionArchivedSnapshot {
  /** 不可变记录UUID。 */
  storage_id: string;
  /** 已验证所属Agent与逻辑身份的小字段元数据。 */
  metadata: SessionHistoryMeta;
  /** 精确归档接口只能返回归档记录。 */
  archived: true;
}
