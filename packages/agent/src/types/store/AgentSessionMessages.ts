/**
 * Agent DB 消息引擎的可序列化事务参数和结果。
 * 不包含运行回调；调用方在派发前完成接收校验，Worker 内只执行短数据库事务。
 */
import type { SessionMessage } from "@downcity/type";
import type { SessionMessageCreateInput } from "./SessionStorage.js";

/** Worker 分配最终 sequence 的新消息提交。 */
export interface AgentSessionAppendMessage {
  /** 幂等操作 UUID，同一请求重试必须复用。 */
  operation_id: string;
  /** 精确目标记录身份，不依赖可重建的逻辑 ID。 */
  storage_id: string;
  /** 已构造并通过领域校验的候选聚合；最终 sequence 由事务分配。 */
  message: SessionMessageCreateInput;
}

/** 单条消息的增量 Part 提交。 */
export interface AgentSessionUpdateMessage {
  /** 幂等操作 UUID。 */
  operation_id: string;
  /** 精确 Session 记录身份。 */
  storage_id: string;
  /** 本次完整领域聚合，用于验证稳定前缀和 envelope 不变量。 */
  message: SessionMessage;
  /** 更新前的已知 revision，防止并发覆盖。 */
  expected_revision: number;
  /** 明确发生变化的 Part，避免逐 token 重写全部历史 Parts。 */
  changed_parts: SessionMessage["parts"];
}

/** 不复制正文的幂等事务确认。 */
export interface AgentSessionMessageCommit {
  /** 消息的 Session 内稳定 ID。 */
  message_id: string;
  /** 数据库实际分配的最终序号。 */
  sequence: number;
  /** 此次已提交 revision，后续更新可以继续推进。 */
  revision: number;
}

/** 正向返回的历史消息页参数。 */
export interface AgentSessionMessagePageInput {
  /** 读取此 sequence 之前的消息，省略表示最新页。 */
  before_sequence?: number;
  /** 默认 50、最大 201，允许领域层多读一条判断 has_more。 */
  limit?: number;
}

/** 单 Session 的消息页和同一短事务计数。 */
export interface AgentSessionMessagePage {
  /** 仅当前页的完整消息聚合，按 sequence 升序。 */
  items: SessionMessage[];
  /** 本页短事务中读取的 canonical 消息数。 */
  total: number;
}

/** 截断、清空等破坏性事务参数。 */
export interface AgentSessionTruncateMessages {
  /** 幂等操作 UUID。 */
  operation_id: string;
  /** 要修改的活动 Session 记录身份。 */
  storage_id: string;
  /** 保留到的 sequence，0 表示清空。 */
  through_sequence: number;
}
