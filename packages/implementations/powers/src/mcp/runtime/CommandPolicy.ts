/**
 * MCP 启动边界：只运行已安装的 Server，不把包安装器当作连接传输。
 *
 * 已知会隐式下载的运行器和包管理操作在建立连接前拒绝；用户需要通过既有、
 * 有审批的安装流程准备可执行程序，再在 TOML 中引用它。这里不实现安装、卸载
 * 或命令解释器，也不声称能分析用户脚本内部的任意副作用。
 */

import { basename } from "node:path";

/** 拒绝已知安装器及会下载软件的包运行入口。 */
export function assert_runtime_command(command: string, args: readonly string[] = []): void {
  const executable = basename(command).toLowerCase().replace(/\.(cmd|exe|bat)$/, "");
  const package_runners = ["npx", "bunx", "uvx", "pip", "pip3", "brew"];
  const package_managers = ["npm", "pnpm", "yarn", "bun", "uv", "corepack"];
  const install_operations = ["install", "i", "add", "remove", "uninstall", "update", "upgrade", "dlx", "exec", "x", "run", "sync", "tool", "create", "init"];
  if (package_runners.includes(executable) || (package_managers.includes(executable) && args.some((arg) => install_operations.includes(arg)))) {
    throw new Error("MCP starts installed programs only. Install or remove software through the existing approved workflow, then configure its executable directly.");
  }
}
