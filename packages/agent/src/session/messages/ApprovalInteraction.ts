/**
 * 审批交互封装。
 *
 * 关键点（中文）
 * - 审批比提问多两件事：读审批模式、解释「批准 / 拒绝」。这两件事属于审批自己。
 * - `always-allow` 时直接返回批准，**不发起交互**：通用原语不知道审批模式的存在。
 * - 通用原语只认识信封与 type 字符串，本类负责把 `approval` 这个类型的 payload 讲通。
 */

import type {
  SessionApprovalDecision,
  SessionApprovalMode,
  SessionApprovalPort,
  SessionApprovalRequestInput,
  SessionInteractionPort,
  SessionInteractionResult,
} from "@downcity/type";
import { SESSION_APPROVAL_RESPONSE_SCHEMA } from "@downcity/type";

/** 把一次高风险操作提交给用户裁定。 */
export class ApprovalInteraction implements SessionApprovalPort {
  private readonly interactions: SessionInteractionPort;
  private readonly read_mode: () => SessionApprovalMode;

  constructor(options: {
    /** 当前 Session 的通用交互原语。 */
    interactions: SessionInteractionPort;
    /** 读取当前审批模式；每次调用实时取值，模式变更立即生效。 */
    read_mode: () => SessionApprovalMode;
  }) {
    this.interactions = options.interactions;
    this.read_mode = options.read_mode;
  }

  /**
   * 请求一次审批。
   *
   * 关键点（中文）
   * - `always-allow` 时不发起交互，直接返回批准；核心不参与该判断。
   * - 其余情况发起 `approval` 交互，并把终态收敛为领域决定。
   * - 非用户参与的结果（取消、失败）一律按未放行处理。
   */
  async request(input: SessionApprovalRequestInput): Promise<SessionApprovalDecision> {
    if (this.read_mode() === "always-allow") {
      return { approved: true, auto_approved: true };
    }

    const handle = await this.interactions.request({
      type: "approval",
      turn_id: input.turn_id,
      tool_call_id: input.tool_call_id,
      ...(input.tool_name ? { tool_name: input.tool_name } : {}),
      ...(input.source_type ? { source_type: input.source_type } : {}),
      ...(input.title ? { title: input.title } : {}),
      ...(input.description ? { description: input.description } : {}),
      payload: input.payload as never,
      response_schema: SESSION_APPROVAL_RESPONSE_SCHEMA,
    });
    const result = await handle.result;
    return {
      approved: is_approved(result),
      auto_approved: false,
      approval_id: handle.interaction_id,
    };
  }
}

/** 判断一次 Interaction 终态是否构成用户批准。 */
function is_approved(result: SessionInteractionResult): boolean {
  if (result.status !== "resolved") return false;
  if (result.response.type !== "approval" || result.response.outcome !== "resolved") {
    return false;
  }
  const payload = result.response.payload;
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return false;
  return (payload as { decision?: "approved" | "denied" }).decision === "approved";
}
