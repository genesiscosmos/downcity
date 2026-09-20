/**
 * Sandbox doctor 探针定义。
 *
 * 关键点（中文）
 * - 探针分两类：`fence` 验证围栏正确性，`environment` 提示宿主工具链与网络状态。
 * - 围栏类探针必须成对出现：一条证明允许的能写，一条证明越界的写不了。
 *   只验证「能写」无法发现围栏失效。
 * - 探针命令只用 POSIX 与宿主常见工具，不引入额外依赖。
 */

import type { SandboxProbe } from "../types/SandboxDoctor.js";

/** 构造探针定义列表。 */
export function build_sandbox_probes(input: {
  /** Workspace 根目录。 */
  workspace_path: string;
  /** Downcity 私有运行目录。 */
  runtime_path: string;
  /** 宿主 HOME，用于越界写入探针。 */
  home_path: string;
  /** 当前进程 pid，用于生成不冲突的探针文件名。 */
  pid: number;
}): SandboxProbe[] {
  const probe_name = `.downcity-doctor-${input.pid}`;
  const inside_target = `${input.workspace_path}/${probe_name}`;
  const runtime_target = `${input.runtime_path}/${probe_name}`;
  const temp_target = "/tmp/" + probe_name;
  const outside_target = `${input.home_path}/${probe_name}`;
  const quoted = (value: string) => JSON.stringify(value);
  return [
    {
      id: "fence_workspace_write",
      title: "Workspace 内可写",
      command: `printf ok > ${quoted(inside_target)} && rm -f ${quoted(inside_target)} && echo allowed`,
      expectation: "succeed",
      severity: "fence",
    },
    {
      id: "fence_runtime_write",
      title: "runtime 私有目录可写",
      command: `printf ok > ${quoted(runtime_target)} && rm -f ${quoted(runtime_target)} && echo allowed`,
      expectation: "succeed",
      severity: "fence",
    },
    {
      id: "fence_temp_write",
      title: "系统临时目录可写",
      command: `printf ok > ${quoted(temp_target)} && rm -f ${quoted(temp_target)} && echo allowed`,
      expectation: "succeed",
      severity: "fence",
    },
    {
      id: "fence_outside_denied",
      title: "HOME 根目录写入被拒",
      command: `printf bad > ${quoted(outside_target)} 2>&1; echo exit=$?`,
      expectation: "deny",
      severity: "fence",
    },
    {
      id: "fence_ssh_denied",
      title: "私钥目录读取被拒",
      command: `ls ${quoted(`${input.home_path}/.ssh`)} > /dev/null 2>&1; echo exit=$?`,
      expectation: "deny",
      severity: "fence",
    },
    {
      id: "env_git",
      title: "git 可用",
      command: "git --version",
      expectation: "succeed",
      severity: "environment",
    },
    {
      id: "env_node",
      title: "node 可用",
      command: "node -v",
      expectation: "succeed",
      severity: "environment",
    },
    {
      id: "env_package_manager",
      title: "包管理器可用",
      command: "pnpm -v || npm -v",
      expectation: "succeed",
      severity: "environment",
    },
    {
      id: "env_network",
      title: "出网可用",
      command: "curl -sS -o /dev/null -w '%{http_code}' https://registry.npmjs.org/",
      expectation: "succeed",
      severity: "environment",
    },
  ];
}
