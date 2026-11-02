/**
 * Power 生命周期内专用 Session 的宿主协议。
 * 注册入口仅出现在可信生命周期上下文，模型工具不能注册任意执行资源。
 */
import type { SessionMessage } from "@downcity/type";
import type { SessionExecutionProfile, SessionExecutionProfileReference } from "@downcity/agent";
import type { PowerSessionTurnResult } from "./PowerContext.js";

/** 宿主注册的专用 Session 配置；resolve 闭包可绑定领域 Job 的受限工具。 */
export type PowerExecutionProfile = SessionExecutionProfile;

/** 有界 canonical 消息页，保留原始来源身份与顺序。 */
export interface PowerHostSessionMessagePage {
  /** 按 sequence 升序排列的完整消息；单消息超出字节预算时明确失败。 */
  messages: SessionMessage[];
  /** 更早一页的排他 sequence 边界；没有更早消息时为空。 */
  next_before_sequence?: number;
  /** 本页消息实际 JSON UTF-8 字节数。 */
  bytes: number;
}

/** 可在宿主重启后重读的 Session 与 Turn 状态。 */
export interface PowerHostSessionState {
  /** 当前 Session 的稳定 ID。 */
  session_id: string;
  /** Session 当前是否存在执行或排队工作。 */
  executing: boolean;
  /** 当前专用配置的持久化身份；普通 Session 为空。 */
  execution_profile?: SessionExecutionProfileReference;
  /** 本次读取定位的 Turn ID；没有提交过请求时为空。 */
  turn_id?: string;
  /** 指定 Turn 的实际状态；缺失请求不视为成功。 */
  status: "idle" | "running" | "completed" | "not_found" | "interrupted";
  /** 仅终态存在的持久化完成结果；不能替代领域提交回执。 */
  result?: PowerSessionTurnResult;
}
