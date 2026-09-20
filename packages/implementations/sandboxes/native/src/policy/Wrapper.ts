/**
 * 平台包装器选择。
 *
 * 关键点（中文）
 * - 平台分支只出现在这里，Shell 与 City 不感知隔离实现。
 * - 返回的命令已经是最终可执行文件，启动器不再做任何解释。
 */

import type { ShellCommandInvocation } from "@downcity/type/shell";
import { build_seatbelt_profile } from "./SeatbeltProfile.js";
import { build_bubblewrap_prefix } from "./BubblewrapArgv.js";
import type { ResolvedSandboxPolicy } from "../types/SandboxPolicy.js";

/** 解析当前平台使用的包装器可执行文件；不支持时返回 null。 */
export function resolve_wrapper_binary(platform: NodeJS.Platform): string | null {
  if (platform === "darwin") return "/usr/bin/sandbox-exec";
  if (platform === "linux") return "/usr/bin/bwrap";
  return null;
}

/** 把原始 shell 调用包装成受围栏约束的最终命令。 */
export function wrap_sandbox_invocation(input: {
  /** 目标平台。 */
  platform: NodeJS.Platform;
  /** 已解析的围栏策略。 */
  policy: ResolvedSandboxPolicy;
  /** 尚未包装的 shell 调用。 */
  invocation: ShellCommandInvocation;
  /** 当前进程环境。 */
  env: NodeJS.ProcessEnv;
}): { command: string; args: string[] } {
  const binary = resolve_wrapper_binary(input.platform);
  if (!binary) {
    throw new Error(`Native sandbox does not support ${input.platform}/${process.arch}`);
  }
  if (input.platform === "darwin") {
    return {
      command: binary,
      args: [
        "-p",
        build_seatbelt_profile({ policy: input.policy, env: input.env }),
        input.invocation.command,
        ...input.invocation.args,
      ],
    };
  }
  return {
    command: binary,
    args: [
      ...build_bubblewrap_prefix(input.policy),
      input.invocation.command,
      ...input.invocation.args,
    ],
  };
}
