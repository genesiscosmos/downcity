/**
 * 自检进程执行器。
 *
 * 命令使用 argv 传参，避免 Shell 插值；超时终止整个进程组。
 * 保留退出信号、超时和有界错误摘要，启动错误不能充当预期的权限拒绝。
 * Electron 的 Node 模式仅注入标记为 Node 脚本的探针子进程，不修改宿主环境。
 */

import { spawn } from "node:child_process";
import type { ShellCommandInvocation } from "@downcity/type/shell";
import { wrap_sandbox_invocation } from "../policy/Wrapper.js";
import type { ResolvedSandboxPolicy } from "../types/SandboxPolicy.js";

/** 探针进程的有界执行结果；只有正常退出才可用于隔离判定。 */
export interface ProbeProcessResult {
  /** 正常退出时的状态码；启动失败、信号终止或超时均为 null。 */
  exit_code: number | null;
  /** 终止进程的系统信号；正常退出或尚未取得信号时为 null。 */
  signal: NodeJS.Signals | null;
  /** 是否超过执行预算；即使随后正常退出也不得判定探针通过。 */
  timed_out: boolean;
  /** 进程启动错误的摘要；成功启动时为 null。 */
  spawn_error: string | null;
  /** 标准错误的有界摘要，不包含命令行、环境变量或标准输出。 */
  stderr: string;
}

/** 单次探针的执行选项。 */
interface ProbeProcessOptions {
  /** 调用是否使用 process.execPath 执行 Node 脚本；Electron 宿主需显式启用 Node 模式。 */
  node_script?: boolean;
}

/** 最长等待时间与标准错误保留字节数。 */
const PROBE_TIMEOUT_MS = 5000;
const STDERR_LIMIT_BYTES = 2048;

/** 只有无启动错误、未超时且无退出信号的进程才能匹配预期退出码。 */
export function probe_exited_with(result: ProbeProcessResult, exit_code: number): boolean {
  return !result.timed_out && result.spawn_error === null
    && result.signal === null && result.exit_code === exit_code;
}

/** 生成供自检报错使用的简短诊断，避免把进程启动失败误报为网络拒绝。 */
export function describe_probe_result(result: ProbeProcessResult): string {
  const reason = result.timed_out ? `timed out after ${PROBE_TIMEOUT_MS} ms`
    : result.spawn_error ? `spawn failed: ${result.spawn_error}`
    : result.signal ? `terminated by ${result.signal}`
    : `exit code ${result.exit_code ?? "unknown"}`;
  const stderr = result.stderr.replace(/[\u0000-\u001f\u007f-\u009f]/g, " ").trim().slice(0, 500);
  return stderr ? `${reason}; stderr: ${stderr}` : reason;
}

/** 在给定策略内执行一个有界探针，保留诊断并终止超时进程组。 */
export async function run_probe_process(
  policy: ResolvedSandboxPolicy,
  invocation: ShellCommandInvocation,
  options: ProbeProcessOptions = {},
): Promise<ProbeProcessResult> {
  const env = options.node_script && process.versions.electron
    ? { ...process.env, ELECTRON_RUN_AS_NODE: "1" }
    : process.env;
  const wrapped = wrap_sandbox_invocation({
    platform: process.platform, policy, invocation, env,
  });
  return await new Promise<ProbeProcessResult>((resolve) => {
    const child = spawn(wrapped.command, wrapped.args, {
      env, stdio: ["ignore", "ignore", "pipe"], detached: true,
    });
    let stderr = Buffer.alloc(0);
    let timed_out = false;
    let settled = false;
    const finish = (exit_code: number | null, signal: NodeJS.Signals | null, spawn_error: string | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ exit_code, signal, timed_out, spawn_error, stderr: stderr.toString("utf8") });
    };
    child.stderr.on("data", (chunk: Buffer) => {
      const remaining = STDERR_LIMIT_BYTES - stderr.length;
      if (remaining > 0) stderr = Buffer.concat([stderr, chunk.subarray(0, remaining)]);
    });
    const timer = setTimeout(() => {
      timed_out = true;
      if (child.pid) {
        try { process.kill(-child.pid, "SIGKILL"); } catch { child.kill("SIGKILL"); }
      }
      finish(null, null, null);
    }, PROBE_TIMEOUT_MS);
    child.once("error", (error) => finish(null, null, error.message.slice(0, 500)));
    child.once("close", (code, signal) => finish(code, signal, null));
  });
}
