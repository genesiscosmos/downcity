/**
 * Shell host 执行审批边界。
 *
 * 关键点（中文）
 * - Shell 负责危险命令校验、权限审计和等待审批结果。
 * - 审批模式与 pending 状态由注入的审批入口所有，本模块不自己判断模式。
 */

import fs from "fs-extra";
import path from "node:path";
import { generate_id } from "@/shell/utils/Id.js";
import type { ShellHostContext } from "@downcity/type/shell";
import type {
  ShellApprovalStatus,
  ShellApprovalToolName,
} from "@downcity/type/shell";
import type { SessionApprovalPayload } from "@downcity/type";
import { now_ms } from "../session/ShellActionRuntimeSupport.js";

const DANGEROUS_HOST_COMMAND_PATTERNS = [
  /\bsudo\b/,
  /\brm\s+-[^&|;\n]*r[^&|;\n]*f\s+\/(?:\s|$)/,
  /\bchmod\s+-R\s+777\s+\/(?:\s|$)/,
  /\bssh-keygen\b/,
  /\bsecurity\s+(?:add|delete|unlock|set|import|export)-/i,
  /(?:^|[\s;&|])(?:nohup\s+)?[^;&|\n]*(?:&)\s*$/,
];

/** 判断命令是否命中 Shell 固定拒绝规则。 */
function is_dangerous_command(cmd: string): boolean {
  return DANGEROUS_HOST_COMMAND_PATTERNS.some((pattern) => pattern.test(cmd));
}

/** 把 stdin 审批预览限制在审计日志可读范围内。 */
function build_input_preview(value: string): string {
  const normalized = String(value || "");
  if (normalized.length <= 240) return normalized;
  return `${normalized.slice(0, 240)}...`;
}

/** 返回 host 执行审计日志路径。 */
function resolve_audit_path(context: ShellHostContext): string {
  return path.join(context.data_path, "logs", "host-execution-audit.jsonl");
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

/** 校验 host 执行请求。 */
export function validate_host_request(params: {
  /** 待执行命令或写入内容。 */
  cmd: string;
  /** 权限申请原因。 */
  reason?: string;
}): string | null {
  const reason = String(params.reason || "").trim();
  if (!reason) return "host execution requires a non-empty reason";
  if (is_dangerous_command(params.cmd)) {
    return "host execution rejected a dangerous command";
  }
  return null;
}

/**
 * 通过当前 Tool 上下文的 Gateway 请求 host 执行权限。
 *
 * Gateway 缺失时按拒绝处理，Shell 绝不会因为宿主集成不完整而直接执行。
 */
export async function request_host_approval(params: {
  /** 当前 Shell 宿主上下文。 */
  context: ShellHostContext;
  /** 当前 Shell 运行标识。 */
  shell_id: string;
  /** 当前请求来源工具。 */
  tool_name: ShellApprovalToolName;
  /** 待执行命令或写入内容。 */
  cmd: string;
  /** 当前工具工作目录。 */
  cwd: string;
  /** 权限申请原因。 */
  reason: string;
  /** 当前 Agent Session。 */
  owner_context_id?: string;
  /** 当前 Turn。 */
  turn_id?: string;
  /** stdin 写入预览。 */
  input_preview?: string;
  /** stdin 写入字符数。 */
  input_chars?: number;
  /** 当前 Downcity Tool Call。 */
  tool_call_id?: string;
}): Promise<{
  /** 当前审批请求标识。 */
  approval_id: string;
  /** 当前审批最终状态。 */
  status: ShellApprovalStatus;
}> {
  const fallback_approval_id = `ap_${generate_id()}`;
  const session_id = String(params.owner_context_id || "").trim();
  const turn_id = String(params.turn_id || "").trim();
  const tool_call_id = String(params.tool_call_id || "").trim();
  const operation = params.tool_name === "shell_write"
    ? "write"
    : params.tool_name === "shell_exec"
      ? "exec"
      : "start";
  const input_preview = params.input_preview === undefined
    ? undefined
    : build_input_preview(params.input_preview);
  const base_record = {
    session_id: session_id || null,
    turn_id: turn_id || null,
    tool_call_id: tool_call_id || null,
    agent_id: params.context.config?.id || null,
    tool_name: params.tool_name,
    shell_id: params.shell_id,
    cmd: params.cmd,
    operation,
    ...(input_preview !== undefined ? { input_preview } : {}),
    ...(typeof params.input_chars === "number" ? { input_chars: params.input_chars } : {}),
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
        created_at: new Date(now_ms()).toISOString(),
      },
    }).catch(() => undefined);
    return { approval_id: fallback_approval_id, status: "denied" };
  }

  const decision = await params.context.approval_gateway.request({
    turn_id,
    tool_call_id,
    tool_name: params.tool_name,
    source_type: "shell",
    title: `Approve ${params.tool_name}`,
    ...(params.reason ? { description: params.reason } : {}),
    payload: {
      operation,
      command: params.cmd,
      cwd: params.cwd,
      reason: params.reason,
      ...(input_preview !== undefined ? { input_preview } : {}),
      ...(typeof params.input_chars === "number" ? { input_chars: params.input_chars } : {}),
    } as SessionApprovalPayload,
  });
  const approval_id = decision.approval_id ?? fallback_approval_id;
  await append_audit({
    context: params.context,
    record: {
      event: decision.auto_approved ? "approval_auto_approved" : "approval_requested",
      approval_id,
      ...base_record,
      created_at: new Date(now_ms()).toISOString(),
    },
  }).catch(() => undefined);

  const status: ShellApprovalStatus = decision.approved ? "approved" : "denied";
  if (!decision.auto_approved) {
    await append_audit({
      context: params.context,
      record: {
        event: "approval_resolved",
        approval_id,
        ...base_record,
        decision: status,
        resolved_at: new Date(now_ms()).toISOString(),
      },
    }).catch(() => undefined);
  }
  return { approval_id, status };
}
