/**
 * 自检进程执行器。
 *
 * 命令使用 argv 传参，避免 Shell 插值；超时终止整个进程组。
 * 只有正常退出才返回程序退出码，启动错误与超时均不能充当预期的权限拒绝。
 */

import { spawn } from "node:child_process";
import type { ShellCommandInvocation } from "@downcity/type/shell";
import { wrap_sandbox_invocation } from "../policy/Wrapper.js";
import type { ResolvedSandboxPolicy } from "../types/SandboxPolicy.js";

/** 在给定策略内执行一个有界探针。 */
export async function run_probe_process(
  policy: ResolvedSandboxPolicy,
  invocation: ShellCommandInvocation,
): Promise<number> {
  const wrapped = wrap_sandbox_invocation({
    platform: process.platform, policy, invocation, env: process.env,
  });
  return await new Promise<number>((resolve) => {
    const child = spawn(wrapped.command, wrapped.args, { stdio: "ignore", detached: true });
    const timer = setTimeout(() => {
      if (child.pid) {
        try { process.kill(-child.pid, "SIGKILL"); } catch { child.kill("SIGKILL"); }
      }
      resolve(-1);
    }, 5000);
    child.once("error", () => { clearTimeout(timer); resolve(-1); });
    child.once("close", (code) => { clearTimeout(timer); resolve(code ?? -1); });
  });
}
