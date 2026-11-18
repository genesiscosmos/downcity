/**
 * Agent DB 中拆分配置及 Composer checkpoint 的可序列化写协议。
 * 明确 null 与省略语义，避免 JSON IPC 将 undefined 误当作清空设置。
 */
import type { SessionModelBinding } from "./SessionModelBinding.js";
import type { SessionExecutionProfileReference } from "../agent/SessionExecutionProfile.js";

/** 一次 configured 值提交，身份、计数和来源不允许由调用方覆盖。 */
export interface AgentSessionConfigurationUpdate {
  /** 幂等事务 UUID。 */
  operation_id: string;
  /** 精确目标记录身份，只允许活动记录写入。 */
  session_id: string;
  /** 可选目录乐观 revision，省略不执行目录 CAS。 */
  expected_revision?: number;
  /** 省略保留，null 清除用户标题。 */
  title?: string | null;
  /** 省略保留，null 清除模型展示标签。 */
  model_label?: string | null;
  /** 省略保留的 configured 时区。 */
  timezone?: string;
  /** 省略保留，null 恢复未显式设置。 */
  approval_mode?: "ask" | "always-allow" | null;
  /** 省略保留，显式覆盖仍记录可靠模型身份。 */
  model_binding?: SessionModelBinding;
  /** 省略保留，已有非空引用仅接受语义同值重入。 */
  execution_profile?: SessionExecutionProfileReference;
  /** 省略保留，null 移除显式快照；非空内容不得隐式截断。 */
  system_snapshot?: string | null;
}

/** Composer 私有命名空间内的累计摘要插入。 */
export interface AgentSessionCheckpointInsert {
  /** 幂等事务 UUID。 */
  operation_id: string;
  /** 精确目标 Session 记录身份。 */
  session_id: string;
  /** Composer 稳定命名空间，不能访问其他 namespace。 */
  namespace: string;
  /** 累计摘要的稳定 ID。 */
  checkpoint_id: string;
  /** 来源 Message ID，与 sequence 指向同一条记录。 */
  through_message_id: string;
  /** 来源消息序号。 */
  through_message_sequence: number;
  /** 已稳定且不切割完整 Step 的 Part 终止序号。 */
  through_part_sequence: number;
  /** 不截断的累计摘要。 */
  summary: string;
  /** Composer checkpoint 自身的结构版本。 */
  schema_version: number;
  /** 累计摘要创建时间戳毫秒。 */
  created_at: number;
}
