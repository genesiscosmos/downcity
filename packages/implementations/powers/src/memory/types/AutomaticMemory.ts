/**
 * 自动 Memory 的入口判定、增量处理与宿主身份协议。
 * 数据仅保存状态和来源 ID，原始对话仍由 Session 维护。
 */
import type { PowerContext } from "@downcity/city/power";
import type { MemoryAccessContext, MemoryWriteTarget } from "./MemoryAccess.js";
import type { MemoryType, MemorySourceReference } from "./Memory.js";

/** Jev 入口判定的候选范围，mixed 不是实际存储范围。 */
export type MemorySaveScope = "none" | "user" | "workspace" | "agent" | "mixed";

/** 可持久化的消息级判定。 */
export interface MemoryMessageDecision {
  /** 消息稳定 ID。 */
  message_id: string;
  /** 消息所在 turn。 */
  turn_id: string;
  /** 候选保存范围。 */
  save_scope: MemorySaveScope;
  /** 本轮是否需要召回。 */
  should_recall: boolean;
  /** 标记是否已整理完成。 */
  processed: boolean;
  /** 判定时可信访问范围。 */
  access: MemoryAccessContext;
}

/** 入口判定失败时保留的来源与可信范围，用于后台补偿。 */
export interface MemoryGateRetry {
  /** 待重新判定的用户消息。 */
  message_id: string;
  /** 原始 turn 标识。 */
  turn_id: string;
  /** 当时的可信访问上下文。 */
  access: MemoryAccessContext;
}

/** 一个 Session 的持久后台状态。 */
export interface MemorySessionState {
  /** Session 所属 Agent。 */
  agent_id: string;
  /** Session 稳定 ID。 */
  session_id: string;
  /** Session 来源存储分区。 */
  origin_type: string;
  /** 已形成记忆的稳定消息序号。 */
  cursor: number;
  /** 最近完成的 turn 状态，供后台排除运行中输入。 */
  turns: Record<string, "completed" | "failed" | "stopped">;
  /** 未完成/已完成判定，支持幂等重放。 */
  decisions: MemoryMessageDecision[];
  /** 尚未完成的入口判定，失败不能等价为不保存。 */
  gate_retries?: MemoryGateRetry[];
  /** 已验证且持久化的写入计划，崩溃后不重复生成。 */
  plan?: MemoryFormationPlan;
  /** 最近后台处理失败原因。 */
  error?: string;
  /** 连续失败次数，用于指数退避。 */
  failures?: number;
  /** 下一次允许后台重试的绝对毫秒时间。 */
  next_retry_at?: number;
  /** 最近成功处理的绝对毫秒时间。 */
  last_success_at?: number;
}

/** 后台单条可写记忆。 */
export interface MemoryFormationItem {
  /** 稳定写入键。 */
  write_key: string;
  /** 最终可信访问范围。 */
  access: MemoryAccessContext;
  /** 实际存储目标。 */
  target: MemoryWriteTarget;
  /** 单条记忆分类。 */
  memory_type: MemoryType;
  /** 独立可理解的短正文。 */
  content: string;
  /** 可选的现有记忆更新目标，必须来自同范围检索。 */
  memory_id?: string;
  /** 仅适用指定 Agent；省略代表范围内全部授权 Agent。 */
  applicable_agent_id?: string;
  /** 支撑正文的 Session 消息引用。 */
  source_refs: MemorySourceReference[];
}

/** 批次写入计划。 */
export interface MemoryFormationPlan {
  /** 成功后推进到的消息序号。 */
  end_sequence: number;
  /** 本次处理的入口标记 ID。 */
  message_ids: string[];
  /** 待幂等执行的写入操作。 */
  items: MemoryFormationItem[];
}

/** 宿主明确注入的用户身份解析器，不解析用户文本或外部聊天 ID。 */
export type MemoryUserResolver = (context: PowerContext, message_id: string) => Promise<string | undefined>;

/** 自动流程的构造选项。 */
export interface AutomaticMemoryOptions {
  /** 显式启用入口与后台整理。 */
  enabled?: boolean;
  /** Federation decision 模型 ID；省略时发现 Jev。 */
  decision_model_id?: string;
  /** 后台文本模型 ID；必须显式选择。 */
  formation_model_id?: string;
  /** 宿主可信身份解析器；缺失时禁用 User 范围。 */
  resolve_user?: MemoryUserResolver;
}
