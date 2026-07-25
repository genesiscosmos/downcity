/**
 * Session 级 Tool 审批 Broker。
 *
 * 关键点（中文）
 * - pending approval、审批模式、超时与用户决定只归当前 Session 所有。
 * - Shell 通过强类型 Gateway 等待结果，不保存或反向发布 Session 状态。
 */

import { generate_id } from "@/utils/Id.js";
import type {
  ShellApprovalGateway,
  ShellApprovalHandle,
  ShellApprovalRequest,
  ShellApprovalStatus,
} from "@downcity/shell";
import type {
  SessionApproval,
  SessionApprovalDecision,
  SessionApprovalMode,
  SessionApprovalModeSnapshot,
  SessionApprovalResult,
} from "@/types/session/SessionApproval.js";
import type { SessionPendingApproval } from "@/types/session/SessionApprovalBroker.js";
import type { SessionMessages } from "@/session/SessionMessages.js";

/** 单个 Session 的审批状态与决定入口。 */
export class SessionApprovalBroker implements ShellApprovalGateway {
  private readonly session_id: string;
  private readonly messages: SessionMessages;
  private readonly pending_by_id = new Map<string, SessionPendingApproval>();
  private mode: SessionApprovalMode = "ask";

  /**
   * @param options Broker 所属 Session 与 Tool Runtime。
   */
  constructor(options: {
    /** 当前 Broker 所属 Session。 */
    session_id: string;
    /** 当前 Session 的 Message 领域入口。 */
    messages: SessionMessages;
  }) {
    this.session_id = options.session_id;
    this.messages = options.messages;
  }

  /** Shell 调用的强类型审批网关入口。 */
  async request(input: ShellApprovalRequest): Promise<ShellApprovalHandle> {
    if (input.session_id !== this.session_id) {
      throw new Error(`Approval Session mismatch: ${input.session_id}`);
    }
    const approval_id = `ap_${generate_id()}`;
    if (this.mode === "always-allow") {
      return {
        approval_id,
        requires_user_decision: false,
        decision: Promise.resolve("approved"),
      };
    }

    const created_at = Date.now();
    const approval: SessionApproval = {
      approval_id,
      session_id: this.session_id,
      turn_id: input.turn_id,
      tool_call_id: input.tool_call_id,
      tool_name: input.tool_name,
      command: input.command,
      cwd: input.cwd,
      reason: input.reason,
      operation: input.operation,
      created_at,
      expires_at: created_at + input.timeout_ms,
    };
    let resolve_decision!: (decision: ShellApprovalStatus) => void;
    const decision = new Promise<ShellApprovalStatus>((resolve) => {
      resolve_decision = resolve;
    });
    const timer = setTimeout(() => {
      void this.expire(approval_id);
    }, input.timeout_ms);
    if (typeof timer.unref === "function") timer.unref();
    this.pending_by_id.set(approval_id, {
      approval,
      resolve: resolve_decision,
      timer,
    });

    try {
      await this.messages.request_tool_approval(approval);
    } catch (error) {
      clearTimeout(timer);
      this.pending_by_id.delete(approval_id);
      resolve_decision("denied");
      throw error;
    }
    return {
      approval_id,
      requires_user_decision: true,
      decision,
    };
  }

  /** 返回当前 Session 的全部 pending approval 快照。 */
  list(): SessionApproval[] {
    return [...this.pending_by_id.values()].map((item) => structuredClone(item.approval));
  }

  /** 返回当前 Session 的审批模式。 */
  get_mode(): SessionApprovalModeSnapshot {
    return { session_id: this.session_id, mode: this.mode };
  }

  /** 更新当前 Session 的审批模式。 */
  set_mode(mode: SessionApprovalMode): SessionApprovalModeSnapshot {
    this.mode = mode === "always-allow" ? "always-allow" : "ask";
    return this.get_mode();
  }

  /** 处理用户提交的审批决定。 */
  async resolve(input: {
    /** 当前审批请求标识。 */
    approval_id: string;
    /** 用户提交的审批决定。 */
    decision: SessionApprovalDecision;
  }): Promise<SessionApprovalResult> {
    const success = await this.settle(input.approval_id, input.decision, false);
    return { success, approval_id: input.approval_id, decision: input.decision };
  }

  /** 让当前 Session 的全部 pending 请求过期，用于停止或销毁执行。 */
  async expire_all(): Promise<void> {
    await Promise.all([...this.pending_by_id.keys()].map((approval_id) =>
      this.settle(approval_id, "expired", true)
    ));
  }

  /** 处理单个自动过期请求。 */
  private async expire(approval_id: string): Promise<void> {
    await this.settle(approval_id, "expired", true);
  }

  /** 先提交 Tool 状态，再兑现 Shell 等待 Promise，保证执行顺序稳定。 */
  private async settle(
    approval_id: string,
    decision: ShellApprovalStatus,
    force: boolean,
  ): Promise<boolean> {
    const pending = this.pending_by_id.get(approval_id);
    if (!pending) return false;
    try {
      await this.messages.resolve_tool_approval({
        approval_id,
        decision,
        tool_call_id: pending.approval.tool_call_id,
      });
    } catch (error) {
      if (!force) throw error;
    }
    clearTimeout(pending.timer);
    this.pending_by_id.delete(approval_id);
    pending.resolve(decision);
    return true;
  }
}
