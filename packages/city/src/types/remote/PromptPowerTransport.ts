/** 请求级 Power 的远程线协议；公开 Prompt 中的函数不得进入此结构。 */
import type { AgentSessionPromptInput } from "@downcity/agent";
import type { PromptPowerDescriptor, PromptPowerEvent, PromptPowerResult, ModelJsonValue } from "@downcity/type";

/** 服务端待完成调用的结果控制器。 */
export interface PendingPromptPowerCall {
  /** 兑现经过 JSON 校验的执行结果。 */
  resolve(value: ModelJsonValue): void;
  /** 拒绝失败或取消的执行。 */
  reject(error: Error): void;
}

/** 远程 Prompt 输入。 */
export interface RemotePromptInput extends Omit<AgentSessionPromptInput, "powers"> {
  /** 无函数的能力描述。 */
  powers?: readonly PromptPowerDescriptor[];
  /** SDK 本次调用创建的临时执行通道。 */
  execution_channel_id?: string;
}

/** SDK 内部执行通道，不对调用者暴露 binding。 */
export interface PromptPowerChannel {
  /** 服务端分配的不可预测标识。 */
  readonly id: string;
  /** 提交调用结果，重复提交按服务端调用终态处理。 */
  result(result: PromptPowerResult): Promise<void>;
  /** 关闭通道并取消尚未结束的调用。 */
  close(): Promise<void>;
}

/** Transport 建立执行通道的输入。 */
export interface OpenPromptPowerChannel {
  /** 通道所属 Session。 */
  session_id: string;
  /** Session 来源分区。 */
  category: string;
  /** 仅向提供方发送执行控制消息。 */
  on_event(event: PromptPowerEvent): void;
  /** 非主动断开时通知 SDK。 */
  on_close(error: unknown): void;
}
