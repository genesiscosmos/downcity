/** Notification等受信界面读取与响应Agent交互的宿主协议；不增加模型审批能力。 */
import type { JsonValue, RespondSessionInteractionInput } from "@downcity/type";

/** 原Session请求的精确引用。 */
export interface PowerInteractionReference {
  /** Session持久化分区。 */
  session_type: "chat" | "work";
  /** 原Session稳定标识。 */
  session_id: string;
  /** 原请求所属执行标识。 */
  turn_id: string;
  /** 原Interaction稳定标识。 */
  interaction_id: string;
}

/** 从用户界面转交原请求的公开响应。 */
export interface PowerInteractionResponse {
  /** 原请求所属主体，由宿主检查。 */
  agent_id: string;
  /** 请求引用，不包含新的执行或授权目标。 */
  reference: PowerInteractionReference;
  /** 用户的真实回答或审批决定；私密内容走原Session专用入口。 */
  response: RespondSessionInteractionInput["response"];
}

/** 受信Power可使用的交互集合能力。 */
export interface PowerInteractionHost {
  /** 读取指定主体全部当前可处理请求，只读不启动模型。 */
  list_agent_interactions(input: { /** 原请求所属Agent。 */ agent_id: string }): Promise<JsonValue>;
  /** 在原Session回应公开问题或审批，不能提交私密输入。 */
  respond_agent_interaction(input: PowerInteractionResponse): Promise<JsonValue>;
}
