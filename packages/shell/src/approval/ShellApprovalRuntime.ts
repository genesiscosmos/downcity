/**
 * Shell unrestricted sandbox 审批边界。
 *
 * 关键点（中文）
 * - Shell 负责危险命令校验、权限审计和等待宿主审批结果。
 * - pending approval、审批模式、超时与用户决定由注入的 Approval Gateway 所有。
 */

import fs from "fs-extra";
import path from "node:path";
import { generateId } from "@/utils/Id.js";
import type { ShellHostContext } from "@/types/ShellHostContext.js";
import type {
  ShellApprovalStatus,
  ShellApprovalToolName,
} from "@/types/ShellAction.js";
import { nowMs } from "../session/ShellActionRuntimeSupport.js";

const DANGEROUS_COMMAND_PATTERNS = [
  /\bsudo\b/,
  /\brm\s+-[^&|;\n]*r[^&|;\n]*f\s+\/(?:\s|$)/,
  /\bchmod\s+-R\s+777\s+\/(?:\s|$)/,
  /\bssh-keygen\b/,
  /\bsecurity\s+(?:add|delete|unlock|set|import|export)-/i,
  /(?:^|[\s;&|])(?:nohup\s+)?[^;&|\n]*(?:&)\s*$/,
];

/** 判断命令是否命中 Shell 固定拒绝规则。 */
function is_dangerous_command(cmd: string): boolean {
  return DANGEROUS_COMMAND_PATTERNS.some((pattern) => pattern.test(cmd));
}

/** 把 stdin 审批预览限制在审计日志可读范围内。 */
function build_input_preview(value: string): string {
  const normalized = String(value || "");
  if (normalized.length <= 240) return normalized;
  return `${normalized.slice(0, 240)}...`;
}

/** 返回 unrestricted 权限审计日志路径。 */
function resolve_audit_path(context: ShellHostContext): string {
  return path.join(context.dataPath, "logs", "unrestricted-sandbox-audit.jsonl");
}

/** 追加一条权限审计记录。 */
async function append_audit(params: {
  /** 当前 Shell 宿主上下文。 */
  context: ShellHostContext;
  /** 需要持久化的审计字段。 */
  record: Record<string, unknown>;
}): Promise<void> {
  const file_path = resolve_audit_path(params.context);
  await fs.ensureDir(path.dirname(file_path));
  await fs.appendFile(file_path, `${JSON.stringify(params.record)}\n`, "utf-8");
}

/** 校验 unrestricted sandbox 请求。 */
export function validateUnrestrictedRequest(params: {
  /** 待执行命令或写入内容。 */
  cmd: string;
  /** 权限申请原因。 */
  reason?: string;
}): string | null {
  const reason = String(params.reason || "").trim();
  if (!reason) return "unrestricted sandbox requires a non-empty reason";
  if (is_dangerous_command(params.cmd)) {
    return "unrestricted sandbox rejected a dangerous command";
  }
  return null;
}

/**
 * 通过当前 Tool 上下文的 Gateway 请求 unrestricted 权限。
 *
 * Gateway 缺失时按拒绝处理，Shell 绝不会因为宿主集成不完整而直接执行。
 */
export async function requestUnrestrictedApproval(params: {
  /** 当前 Shell 宿主上下文。 */
  context: ShellHostContext;
  /** 当前 Shell 运行标识。 */
  shellId: string;
  /** 当前请求来源工具。 */
  toolName: ShellApprovalToolName;
  /** 待执行命令或写入内容。 */
  cmd: string;
  /** 当前工具工作目录。 */
  cwd: string;
  /** 权限申请原因。 */
  reason: string;
  /** 当前 Agent Session。 */
  ownerContextId?: string;
  /** 当前 Turn。 */
  turnId?: string;
  /** stdin 写入预览。 */
  inputPreview?: string;
  /** stdin 写入字符数。 */
  inputChars?: number;
  /** 当前 AI SDK Tool Call。 */
  toolCallId?: string;
  /** 人工审批最长等待时间。 */
  timeoutMs: number;
}): Promise<{
  /** 当前审批请求标识。 */
  approvalId: string;
  /** 当前审批最终状态。 */
  status: ShellApprovalStatus;
}> {
  const fallback_approval_id = `ap_${generateId()}`;
  const session_id = String(params.ownerContextId || "").trim();
  const turn_id = String(params.turnId || "").trim();
  const tool_call_id = String(params.toolCallId || "").trim();
  const operation = params.toolName === "shell_write"
    ? "write"
    : params.toolName === "shell_exec"
      ? "exec"
      : "start";
  const input_preview = params.inputPreview === undefined
    ? undefined
    : build_input_preview(params.inputPreview);
  const base_record = {
    session_id: session_id || null,
    turn_id: turn_id || null,
    tool_call_id: tool_call_id || null,
    agent_id: params.context.config?.id || null,
    tool_name: params.toolName,
    shell_id: params.shellId,
    cmd: params.cmd,
    operation,
    ...(input_preview !== undefined ? { input_preview } : {}),
    ...(typeof params.inputChars === "number" ? { input_chars: params.inputChars } : {}),
    cwd: params.cwd,
    reason: params.reason,
  };

  if (!params.context.approval_gateway || !session_id || !turn_id || !tool_call_id) {
    await append_audit({
      context: params.context,
      record: {
        event: "approval_rejected_no_gateway",
        approval_id: fallback_approval_id,
        ...base_record,
        created_at: new Date(nowMs()).toISOString(),
      },
    }).catch(() => undefined);
    return { approvalId: fallback_approval_id, status: "denied" };
  }

  const handle = await params.context.approval_gateway.request({
    shell_id: params.shellId,
    tool_call_id,
    tool_name: params.toolName,
    session_id,
    turn_id,
    command: params.cmd,
    cwd: params.cwd,
    reason: params.reason,
    operation,
    ...(input_preview !== undefined ? { input_preview } : {}),
    ...(typeof params.inputChars === "number" ? { input_chars: params.inputChars } : {}),
    timeout_ms: params.timeoutMs,
  });
  await append_audit({
    context: params.context,
    record: {
      event: handle.requires_user_decision ? "approval_requested" : "approval_auto_approved",
      approval_id: handle.approval_id,
      ...base_record,
      created_at: new Date(nowMs()).toISOString(),
    },
  }).catch(() => undefined);

  const status = await handle.decision;
  if (handle.requires_user_decision) {
    await append_audit({
      context: params.context,
      record: {
        event: "approval_resolved",
        approval_id: handle.approval_id,
        ...base_record,
        decision: status,
        resolved_at: new Date(nowMs()).toISOString(),
      },
    }).catch(() => undefined);
  }
  return { approvalId: handle.approval_id, status };
}
