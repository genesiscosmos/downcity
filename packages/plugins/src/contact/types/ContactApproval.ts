/**
 * contact approve 协议运行时类型。
 *
 * 关键点（中文）
 * - 这里只描述 link approve 状态机需要的输入，不包含具体存储实现。
 * - link approve 是点对点能力码消费流程，token 由协议自动交换。
 */

import type { ContactApproveLinkRequest } from "./ContactLink.js";
import type { ContactEndpointReachability } from "./ContactEndpoint.js";
import type { ContactApproveCallbackReason } from "./ContactLink.js";

/**
 * approve 方对“是否提供回连候选”的本地推导结果。
 */
export interface ContactApproveCallbackDecision {
  /**
   * approve 方是否应该把自己的 endpoint/token 作为回连候选发给发起方做 confirm。
   */
  callbackOffered: boolean;
  /**
   * 本次推导的原因。
   */
  reason: ContactApproveCallbackReason;
  /**
   * approve 方自己的 endpoint；仅当推导过程解析出了 endpoint 时存在。
   */
  endpoint?: string;
  /**
   * approve 方 endpoint 的粗粒度可达范围。
   */
  requesterReachability: ContactEndpointReachability;
  /**
   * link code 中目标 endpoint 的粗粒度可达范围。
   */
  targetReachability: ContactEndpointReachability;
}

/**
 * 处理远端 contact link approve 请求的输入。
 */
export interface ApproveContactLinkRequestInput {
  /**
   * 当前 agent 项目根目录，用于读取 link 记录并保存 contact。
   */
  data_path: string;
  /**
   * 当前 agent 名称，也就是 link 所属方名称。
   */
  ownerAgentName: string;
  /**
   * 当前 agent 对外 endpoint；当 link 记录不存在时仍会返回该值辅助诊断。
   */
  ownerEndpoint: string;
  /**
   * approve 方发来的 link id、secret、agent 名称和可选回连信息。
   */
  request: ContactApproveLinkRequest;
  /**
   * 当前时间戳；测试可注入，生产环境默认使用 Date.now()。
   */
  nowMs?: number;
}

/**
 * 远端 contact confirm 请求。
 */
export interface ContactConfirmRequest {
  /**
   * 被 confirm 的 link id。
   */
  linkId: string;
  /**
   * link code 中的一次性明文 secret，用于确认请求来自同一个 approve 方。
   */
  secret: string;
  /**
   * approve 方 agent 名称。
   */
  agentName: string;
  /**
   * approve 方提供给发起方主动检查的 endpoint。
   */
  endpoint: string;
  /**
   * 发起方主动调用 approve 方时携带的 token。
   */
  tokenForRequester: string;
}

/**
 * 远端 contact confirm 响应。
 */
export interface ContactConfirmResponse {
  /**
   * confirm 请求是否执行成功。
   */
  success: boolean;
  /**
   * 发起方 agent 名称。
   */
  agentName: string;
  /**
   * 发起方是否已确认可以主动回连 approve 方。
   */
  confirmed: boolean;
  /**
   * confirm 后发起方保存的 contact 方向。
   */
  reachability: "inbound" | "bidirectional";
  /**
   * confirm 失败原因。
   */
  error?: string;
}

/**
 * 处理远端 contact confirm 请求的输入。
 */
export interface ConfirmContactLinkRequestInput {
  /**
   * 当前 agent 项目根目录，用于读取 link 记录并更新 contact。
   */
  data_path: string;
  /**
   * 当前 agent 名称，也就是 link 所属方名称。
   */
  ownerAgentName: string;
  /**
   * confirm 方发来的 link id、secret、agent 名称和回连 token。
   */
  request: ContactConfirmRequest;
  /**
   * 发起方主动 ping approve 方的验证函数；只有验证成功才能升级为 bidirectional。
   */
  verifyCallback: (params: {
    /**
     * approve 方提供的回连 endpoint。
     */
    endpoint: string;
    /**
     * 发起方调用 approve 方时携带的 token。
     */
    token: string;
  }) => Promise<boolean>;
  /**
   * 当前时间戳；测试可注入，生产环境默认使用 Date.now()。
   */
  nowMs?: number;
}
