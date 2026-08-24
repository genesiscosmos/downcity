/**
 * Shell 审批到 Session Interaction 的执行边界 Adapter。
 *
 * Shell 只理解高风险命令审批协议；本 Adapter 把它转换成 Session 的通用
 * approval Interaction，并把 Interaction 终态映射回 Shell 决策。
 */

import type {
  ShellApprovalGateway,
  ShellApprovalHandle,
  ShellApprovalRequest,
  ShellApprovalStatus,
} from "@downcity/workspace";
import type { SessionInteractions } from "@/session/control/SessionInteractions.js";
import type { SessionApprovalMode } from "@/types/session/SessionInteraction.js";
import { generate_id } from "@/utils/Id.js";

/** 单个 Session 的 Shell 高风险操作审批 Adapter。 */
export class SessionShellApprovalAdapter implements ShellApprovalGateway {
  private readonly session_id: string;
  private readonly interactions: SessionInteractions;
  private mode: SessionApprovalMode = "ask";

  constructor(options: {
    /** 当前 Adapter 所属 Session 标识。 */
    session_id: string;
    /** 当前 Session 的异步用户交互入口。 */
    interactions: SessionInteractions;
  }) {
    this.session_id = String(options.session_id || "").trim();
    this.interactions = options.interactions;
    if (!this.session_id) {
      throw new Error(
        "SessionShellApprovalAdapter requires a non-empty session_id",
      );
    }
  }

  /** 把 Shell 高风险操作请求转换成 approval Interaction。 */
  async request(input: ShellApprovalRequest): Promise<ShellApprovalHandle> {
    if (input.session_id !== this.session_id) {
      throw new Error(`Approval Session mismatch: ${input.session_id}`);
    }
    const interaction_id = `interaction:${generate_id()}`;
    if (this.mode === "always-allow") {
      return {
        approval_id: interaction_id,
        requires_user_decision: false,
        decision: Promise.resolve("approved"),
      };
    }

    const created_at = Date.now();
    const handle = await this.interactions.request({
      interaction_id,
      turn_id: input.turn_id,
      type: "approval",
      source: {
        type: "tool",
        tool_call_id: input.tool_call_id,
        tool_name: input.tool_name,
      },
      title: `Approve ${input.tool_name}`,
      description: input.reason,
      payload: {
        operation: input.operation,
        command: input.command,
        cwd: input.cwd,
        reason: input.reason,
      },
      response_schema: {
        type: "object",
        required: ["decision"],
        properties: {
          decision: { type: "string", enum: ["approved", "denied"] },
        },
      },
      created_at,
      expires_at: created_at + input.timeout_ms,
    });

    return {
      approval_id: interaction_id,
      requires_user_decision: true,
      decision: handle.result.then((result): ShellApprovalStatus => {
        if (result.status === "expired") return "expired";
        if (result.status !== "resolved") return "denied";
        if (result.status !== "resolved" || result.response.type !== "approval") return "denied";
        const payload = result.response.payload;
        if (!payload || typeof payload !== "object" || Array.isArray(payload)) return "denied";
        return (payload as { decision?: "approved" | "denied" }).decision || "denied";
      }),
    };
  }

  /** 读取当前 Session 执行面使用的高风险操作审批模式。 */
  get_effective_mode(): SessionApprovalMode {
    return this.mode;
  }

  /** 在 Session Step 检查点提交后续高风险操作请求使用的审批模式。 */
  set_effective_mode(mode: SessionApprovalMode): void {
    this.mode = mode === "always-allow" ? "always-allow" : "ask";
  }
}
