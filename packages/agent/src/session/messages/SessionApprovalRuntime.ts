/**
 * Session 统一审批运行时。
 *
 * 关键点（中文）
 * - 这是 Session 内唯一的审批入口：工具审批与 Shell host 审批都走这里。
 * - 审批模式（ask / always-allow）只在这里生效，因此模式对所有审批一视同仁。
 * - 本类只把请求转成 canonical approval Interaction，不拥有 Interaction 状态；
 *   终态与排队仍由 SessionMessages / SessionInteractions 负责。
 */

import type {
  ShellApprovalGateway,
  ShellApprovalHandle,
  ShellApprovalRequest,
  ShellApprovalStatus,
  SessionApprovalMode,
} from "@downcity/type";
import { SESSION_APPROVAL_RESPONSE_SCHEMA } from "@downcity/type";
import type { SessionInteractions } from "@/session/messages/SessionInteractions.js";
import type {
  SessionApprovalHandle,
  SessionApprovalPort,
  SessionApprovalRequest,
} from "@/types/turn/SessionTurnContext.js";
import { generate_id } from "@/utils/Id.js";

/** Session 内统一的审批运行时。 */
export class SessionApprovalRuntime implements ShellApprovalGateway, SessionApprovalPort {
  private readonly session_id: string;
  private readonly interactions: SessionInteractions;
  private mode: SessionApprovalMode = "ask";

  constructor(options: {
    /** 当前运行时所属 Session 标识。 */
    session_id: string;
    /** 当前 Session 的异步用户交互入口。 */
    interactions: SessionInteractions;
  }) {
    this.session_id = String(options.session_id || "").trim();
    this.interactions = options.interactions;
    if (!this.session_id) {
      throw new Error("SessionApprovalRuntime requires a non-empty session_id");
    }
  }

  /**
   * 把 Shell 高风险操作请求转换成 approval Interaction。
   *
   * 关键点（中文）
   * - Shell 仍负责校验命令与读取沙箱事实，这里只负责「问不问、问什么、怎么答」。
   */
  async request(input: ShellApprovalRequest): Promise<ShellApprovalHandle> {
    if (input.session_id !== this.session_id) {
      throw new Error(`Approval Session mismatch: ${input.session_id}`);
    }
    return await this.decide({
      turn_id: input.turn_id,
      tool_call_id: input.tool_call_id,
      tool_name: input.tool_name,
      source_type: "shell",
      title: `Approve ${input.tool_name}`,
      description: input.reason,
      payload: {
        operation: input.operation,
        command: input.command,
        cwd: input.cwd,
        reason: input.reason,
        ...(input.input_preview !== undefined ? { input_preview: input.input_preview } : {}),
        ...(typeof input.input_chars === "number" ? { input_chars: input.input_chars } : {}),
      },
    });
  }

  /**
   * 把通用工具审批请求转换成 approval Interaction。
   *
   * 关键点（中文）
   * - payload 只带工具自身语义（operation + validated_input）与用途说明。
   * - 工具审批历史上不带 title / description，保持一致。
   */
  async request_tool(input: SessionApprovalRequest): Promise<SessionApprovalHandle> {
    if (String(input.session_id || "").trim() !== this.session_id) {
      throw new Error(`Approval Session mismatch: ${input.session_id}`);
    }
    return await this.decide({
      turn_id: input.turn_id,
      tool_call_id: input.tool_call_id,
      tool_name: input.tool_name,
      source_type: "tool",
      payload: {
        operation: "tool",
        validated_input: input.input,
        ...(input.tool_description ? { tool_description: input.tool_description } : {}),
      },
    });
  }

  /** 读取当前 Session 执行面使用的审批模式。 */
  get_effective_mode(): SessionApprovalMode {
    return this.mode;
  }

  /** 在 Session Step 检查点提交后续审批请求使用的模式。 */
  set_effective_mode(mode: SessionApprovalMode): void {
    this.mode = mode === "always-allow" ? "always-allow" : "ask";
  }

  /**
   * 统一决策入口：先看模式，再决定是否进入人工队列。
   *
   * 关键点（中文）
   * - `always-allow` 直接放行，且不创建 Interaction。
   * - 其余情况创建 canonical approval Interaction，并把终态映射为放行或拒绝。
   */
  private async decide(input: {
    /** 当前请求所属 Turn。 */
    readonly turn_id: string;
    /** 当前请求关联的 Tool Call。 */
    readonly tool_call_id: string;
    /** 发起审批的工具名。 */
    readonly tool_name: string;
    /** Interaction 来源类型。 */
    readonly source_type: "tool" | "shell";
    /** 审批标题；Shell 审批使用，工具审批不设。 */
    readonly title?: string;
    /** 可选描述；一般是请求理由。 */
    readonly description?: string;
    /** 审批 payload。 */
    readonly payload: Record<string, unknown>;
  }): Promise<{
    approval_id: string;
    requires_user_decision: boolean;
    decision: Promise<ShellApprovalStatus>;
  }> {
    const interaction_id = `interaction:${generate_id()}`;
    if (this.mode === "always-allow") {
      return {
        approval_id: interaction_id,
        requires_user_decision: false,
        // 模式放行不是用户决定；类型上与 Shell 的决定枚举一致。
        decision: Promise.resolve("approved" as ShellApprovalStatus),
      };
    }

    const handle = await this.interactions.request({
      interaction_id,
      turn_id: input.turn_id,
      type: "approval",
      source: {
        type: input.source_type,
        tool_call_id: input.tool_call_id,
        tool_name: input.tool_name,
      },
      ...(input.title ? { title: input.title } : {}),
      ...(input.description ? { description: input.description } : {}),
      payload: input.payload as never,
      response_schema: SESSION_APPROVAL_RESPONSE_SCHEMA,
      created_at: Date.now(),
    });

    return {
      approval_id: interaction_id,
      requires_user_decision: true,
      decision: handle.result.then((result): ShellApprovalStatus => {
        if (result.status !== "resolved") return "denied";
        if (result.response.outcome !== "resolved" || result.response.type !== "approval") {
          return "denied";
        }
        const payload = result.response.payload;
        if (!payload || typeof payload !== "object" || Array.isArray(payload)) return "denied";
        return (payload as { decision?: "approved" | "denied" }).decision || "denied";
      }),
    };
  }
}
