/**
 * Linux bubblewrap argv 生成。
 *
 * 关键点（中文）
 * - 从只读宿主根开始，保留系统可执行文件、动态库与工具链。
 * - 先开放写入，再覆盖只读子树，最后隐藏拒绝子树；限制不能被写授权重新开放。
 * - /dev 和 /proc 使用新实例，不把宿主设备树与进程视图重新 bind 回来。
 * - 拒绝路径被空挂载遮蔽，文件可读到空内容，但不能获取宿主原始内容。
 */

import { existsSync, statSync } from "node:fs";
import type { ResolvedSandboxPolicy } from "../types/SandboxPolicy.js";
import { is_path_inside_root } from "./PathMatch.js";

/**
 * 把策略渲染成 bwrap 前缀参数；不包含最终命令。
 *
 * 关键点（中文）：返回值以 `--` 结尾，调用方直接追加可执行文件与参数。
 */
export function build_bubblewrap_prefix(policy: ResolvedSandboxPolicy): string[] {
  const args = [
    "--die-with-parent",
    "--unshare-pid",
    "--unshare-ipc",
    "--unshare-uts",
    "--new-session",
    "--ro-bind", "/", "/",
    "--dev",
    "/dev",
    "--proc",
    "/proc",
  ];
  if (policy.network === "deny") args.push("--unshare-net");
  for (const rule of policy.filesystem_rules.filter((rule) => rule.access === "write")) {
    if (rule.source === "device") continue;
    args.push("--bind", rule.path, rule.path);
  }
  for (const access of ["read", "deny"] as const) {
    for (const rule of policy.filesystem_rules.filter((rule) => rule.access === access)) {
      if (!existsSync(rule.path)) {
        // 可写父树内不存在的限制路径无法安全挂载；拒绝执行，避免创建路径后绕过限制。
        if (policy.writable_roots.some((root) => is_path_inside_root(root, rule.path))) {
          throw new Error(`Cannot enforce sandbox restriction on missing path: ${rule.path}`);
        }
        continue;
      }
      if (access === "read") {
        args.push("--ro-bind", rule.path, rule.path);
      } else if (statSync(rule.path).isDirectory()) {
        args.push("--tmpfs", rule.path, "--remount-ro", rule.path);
      } else {
        args.push("--ro-bind", "/dev/null", rule.path);
      }
    }
  }
  args.push("--");
  return args;
}
