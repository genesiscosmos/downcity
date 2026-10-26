/**
 * 宿主授权的 SSH 身份接入。
 *
 * 只认可 Provider 的 socket 与专用 known_hosts，拒绝命令环境替换身份。
 * Git 的默认 SSH 命令忽略用户配置，不读私钥，严格验证主机，不启用 forwarding。
 * 此配置是 Git 调用默认值，不是命令白名单；socket 使用者仍拥有其可用身份的签名能力。
 */

import { realpathSync, statSync } from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import type { NativeSshAccess } from "../types/NativeProvider.js";
import type { ResolvedSandboxPolicy } from "../types/SandboxPolicy.js";

/** 校验并快照宿主授权路径，把授权纳入策略审计摘要。 */
export function authorize_ssh(policy: ResolvedSandboxPolicy, ssh?: NativeSshAccess): ResolvedSandboxPolicy {
  if (!ssh) return policy;
  if (policy.network !== "allow") throw new Error("SSH authorization requires network=allow");
  if (!path.isAbsolute(ssh.socket_path) || !path.isAbsolute(ssh.known_hosts_path)) {
    throw new Error("SSH authorization requires absolute socket and known_hosts paths");
  }
  const socket_path = realpathSync(ssh.socket_path);
  const known_hosts_path = realpathSync(ssh.known_hosts_path);
  if ([socket_path, known_hosts_path].some((value) => /[\r\n\0\\"%]/.test(value))) {
    throw new Error("SSH endpoint paths cannot contain control characters, backslashes, quotes or SSH expansion tokens");
  }
  if (!statSync(socket_path).isSocket()) throw new Error("SSH socket_path must be a Unix socket");
  if (!statSync(known_hosts_path).isFile()) throw new Error("SSH known_hosts_path must be a regular file");
  const authorized = { socket_path, known_hosts_path };
  return {
    ...policy, ssh: authorized,
    digest: createHash("sha256").update(JSON.stringify([policy.digest, authorized])).digest("hex").slice(0, 16),
  };
}

/** Shell 单引号转义；路径只作为 SSH 参数使用。 */
function quote_shell(value: string): string {
  return "'" + value.replaceAll("'", "'\\''") + "'";
}

/** 注入获准身份与 Git SSH 默认值；不接受命令提供的替代 SSH helper。 */
export function apply_ssh_environment(env: Record<string, string>, policy: ResolvedSandboxPolicy): void {
  delete env.SSH_AUTH_SOCK;
  delete env.SSH_AGENT_PID;
  if (!policy.ssh) return;
  const { socket_path, known_hosts_path } = policy.ssh;
  // 每次启动前重新确认端点类型和真实路径，失效时拒绝而不静默回退。
  if (realpathSync(socket_path) !== socket_path || !statSync(socket_path).isSocket()
    || realpathSync(known_hosts_path) !== known_hosts_path || !statSync(known_hosts_path).isFile()) {
    throw new Error("Authorized SSH endpoint changed; rebind the Workspace");
  }
  env.SSH_AUTH_SOCK = socket_path;
  delete env.GIT_SSH;
  delete env.GIT_SSH_VARIANT;
  const options = [
    "BatchMode=yes", "StrictHostKeyChecking=yes", "UpdateHostKeys=no",
    "GlobalKnownHostsFile=/dev/null", `UserKnownHostsFile="${known_hosts_path.replaceAll('"', '\\"')}"`,
    `IdentityAgent="${socket_path.replaceAll('"', '\\"')}"`, "IdentityFile=none",
    "ForwardAgent=no", "PasswordAuthentication=no", "KbdInteractiveAuthentication=no",
  ];
  env.GIT_SSH_COMMAND = ["/usr/bin/ssh", "-F", "/dev/null", ...options.flatMap((option) => ["-o", quote_shell(option)])].join(" ");
}
