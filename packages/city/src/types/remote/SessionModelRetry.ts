/**
 * 模型 Retry 的传输响应类型。
 * 传输只返回当次控制提交的业务结果，不持有原输入或可持久化的恢复回执。
 */
import type { SessionModelRetryResult } from "@downcity/type";

/** HTTP 路由的普通响应信封；网络或路由失败可不携带业务结果。 */
export interface SessionModelRetryHttpPayload {
  /** 路由是否正常处理；业务是否接受仍由 result.accepted 决定。 */
  success?: boolean;
  /** 原请求的新执行对动作的接收结果。 */
  result?: SessionModelRetryResult;
  /** 路由或存储失败的可展示说明，不作为恢复执行的依据。 */
  error?: string;
}

/** RPC 成功帧中的普通业务结果，帧身份由已有传输协议负责。 */
export interface SessionModelRetryRpcPayload {
  /** 原请求的新执行对动作的接收结果，不是持久化回执。 */
  result: SessionModelRetryResult;
}
