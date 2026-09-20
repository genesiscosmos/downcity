/**
 * macOS seatbelt profile 生成。
 *
 * 关键点（中文）
 * - 默认拒绝，再按策略逐条放行；策略是唯一放行来源。
 * - 读用「全局允许 + 敏感目录 deny 排除」，因为 `(allow file-read* (subpath ...))`
 *   会让当前 macOS 的 sandbox-exec SIGABRT（P0 实测）。
 * - 写用白名单，实测可正常生效。
 * - DNS 与 ssh-agent 走 unix socket，必须单独放行 network-outbound 目标。
 * - sandbox-exec 自 10.8 起标记 deprecated，可用性由 Provider.check() 的 canary 兜住。
 */

import type { ResolvedSandboxPolicy } from "../types/SandboxPolicy.js";

/** 转义 seatbelt 字符串字面量。 */
function escape_literal(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll("\"", "\\\"");
}

/** 渲染一条 allow 子句。 */
function render_allow(
  rule: ResolvedSandboxPolicy["write_rules"][number],
): string {
  const matcher = rule.scope === "literal" ? "literal" : "subpath";
  return `(allow file-write* (${matcher} "${escape_literal(rule.path)}"))`;
}

/** 渲染一条 deny 子句。 */
function render_deny(
  rule: ResolvedSandboxPolicy["deny_read_rules"][number],
): string {
  const matcher = rule.scope === "literal" ? "literal" : "subpath";
  return `(deny file-read* (${matcher} "${escape_literal(rule.path)}"))`;
}

/** 生成一次命令执行使用的完整 seatbelt profile。 */
export function build_seatbelt_profile(input: {
  /** 已解析的围栏策略。 */
  policy: ResolvedSandboxPolicy;
  /** 当前进程环境，用于取出 ssh-agent socket 目标。 */
  env: NodeJS.ProcessEnv;
}): string {
  const lines = [
    "(version 1)",
    "(deny default)",
    "(allow process-fork)",
    "(allow process-exec)",
    "(allow signal (target self))",
    "(allow sysctl-read)",
    "(allow mach-lookup)",
    "(allow ipc-posix-shm)",
    "(allow file-read-metadata)",
    "(allow file-read*)",
    ...input.policy.deny_read_rules.map(render_deny),
    ...input.policy.write_rules.map(render_allow),
  ];
  if (input.policy.network === "allow") {
    lines.push(
      "(allow network-outbound)",
      "(allow network-outbound (literal \"/var/run/mDNSResponder\"))",
    );
    const ssh_auth_sock = String(input.env.SSH_AUTH_SOCK || "").trim();
    if (ssh_auth_sock) {
      lines.push(`(allow network-outbound (literal "${escape_literal(ssh_auth_sock)}"))`);
    }
  }
  return `${lines.join("\n")}\n`;
}
