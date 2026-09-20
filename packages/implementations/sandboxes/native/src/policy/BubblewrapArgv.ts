/**
 * Linux bubblewrap argv 生成。
 *
 * 关键点（中文）
 * - 不启用 `--unshare-net`：保留宿主网络与 DNS，符合本地执行定位。
 * - 规则按策略给出的顺序 bind，深路径后应用，语义与 seatbelt 保持一致。
 * - 与 macOS 的差异必须明确：Linux 可以用 `--ro-bind` 做真正的读白名单，
 *   而 macOS 只能做 deny 排除。两者读语义不等价，调用方不能假设围栏一致。
 */

import type { ResolvedSandboxPolicy } from "../types/SandboxPolicy.js";

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
    "--dev",
    "/dev",
    "--proc",
    "/proc",
  ];
  if (policy.network === "deny") args.push("--unshare-net");
  for (const rule of policy.write_rules) {
    args.push(rule.access === "rw" ? "--bind" : "--ro-bind", rule.path, rule.path);
  }
  args.push("--");
  return args;
}
