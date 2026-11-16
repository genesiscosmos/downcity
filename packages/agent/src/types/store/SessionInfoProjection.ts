/**
 * Session 详情的纯投影输入。
 * 只描述已经读取的 canonical 元数据与消息，不携带数据库位置或文件系统能力。
 */
import type { SessionMessage } from "@downcity/type";
import type { SessionHistoryMeta } from "./SessionHistoryMeta.js";

/** 由存储或执行层提供的详情事实。 */
export interface SessionInfoProjectionInput {
  /** 当前会话所属 Agent，用于返回详情的拥有者路由。 */
  agent_id: string;
  /** 会话永久 UUID；归档和 Workspace 变更不会改变该身份。 */
  session_id: string;
  /** 权威存储已经读取的轻量元数据，投影过程不执行 I/O。 */
  metadata: SessionHistoryMeta;
  /** 可选 canonical 消息；提供时使用最后一条生成短预览。 */
  messages?: SessionMessage[];
  /** 调用瞬间的执行状态，不作为持久化状态写回。 */
  executing?: boolean;
}
