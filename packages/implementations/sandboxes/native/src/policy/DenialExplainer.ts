/**
 * 围栏拒绝解释。
 *
 * 关键点（中文）
 * - 从失败输出里提取候选路径，再与已解析策略交叉比对，给出可执行的下一步。
 * - 无法定位时返回通用解释，不猜测具体原因。
 * - 只做词法匹配与策略查询，不额外读文件系统。
 */

import path from "node:path";
import type { SandboxDenialExplanation } from "@downcity/type/shell";
import { is_path_inside_root } from "./PathMatch.js";
import type { ResolvedSandboxPolicy } from "../types/SandboxPolicy.js";

/** 判定输出是否表达了权限拒绝。 */
function is_permission_denied(output: string): boolean {
  return DENIAL_PATTERN.test(output);
}

/** 权限拒绝的错误行结构：`<程序>: <路径>: <原因>`。 */
const DENIAL_PATTERN = /permission denied|operation not permitted|read-only file system|out of pty devices/i;

const DENIAL_PATH_PATTERN =
  /^(.*):\s*(?:permission denied|operation not permitted|read-only file system)/i;

/**
 * 从失败输出中提取被拒的宿主路径。
 *
 * 关键点（中文）
 * - 只解析带拒绝原因的错误行，避免把 shell 自身路径（如 `/bin/sh`）当成目标。
 * - 取原因前最后一个绝对路径段：错误行通常是 `<程序>: <路径>: <原因>`。
 * - 相对路径不在此处理：无法确认基准目录时交给调用方回落通用提示。
 */
function extract_denied_paths(output: string): string[] {
  const paths: string[] = [];
  for (const line of output.split("\n")) {
    const match = line.match(DENIAL_PATH_PATTERN);
    if (!match) continue;
    const candidate = match[1]
      .split(":")
      .map((segment) => segment.trim().replace(/^['"]|['"]$/g, ""))
      .filter((segment) => path.isAbsolute(segment))
      .at(-1);
    if (!candidate) continue;
    paths.push(path.resolve(candidate));
  }
  return paths;
}

/** 把一次失败输出翻译成围栏解释；不是权限问题时返回 null。 */
export function explain_sandbox_denial(input: {
  /** 子进程合并后的完整输出。 */
  output: string;
  /** 当前生效策略。 */
  policy: ResolvedSandboxPolicy;
}): SandboxDenialExplanation | null {
  if (!is_permission_denied(input.output)) return null;
  const writable_roots = input.policy.writable_roots;
  const denied_path = extract_denied_paths(input.output)
    .find((candidate) => !writable_roots.some((root) => is_path_inside_root(root, candidate)));
  if (!denied_path) {
    return {
      path: "",
      code: "write_denied",
      reason:
        "The sandbox denied this operation but the target path could not be located. "
        + "Only the Workspace, its runtime directory, temporary directories and device nodes "
        + "are writable.",
      writable_roots,
    };
  }
  return {
    path: denied_path,
    code: "write_denied",
    reason:
      `The sandbox denied writing to ${denied_path}. Only the Workspace, its runtime directory, `
      + "temporary directories and device nodes are writable.",
    writable_roots,
  };
}
