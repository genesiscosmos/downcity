/**
 * Downcity 本地 City 根命令装配模块。
 *
 * 关键点（中文）
 * - `downcity`（别名 `city`）是本机 Agent 与全局配置命令入口。
 * - Federation 运维能力（create / deploy / manage / env）统一进入 `downfed` 命令。
 * - 无参数时进入交互式 City 管理 TUI。
 * - 本模块承载 City commander 根命令，`src/index.ts` 只负责进程入口分发。
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Command, Option } from "commander";
import { registerAgentCommands } from "@/city/command/AgentCommand.js";
import { registerGatewayCommands } from "@/city/command/GatewayCommand.js";
import { registerPluginsCommand } from "@/city/command/PluginCommand.js";
import { register_web_command } from "@/city/command/WebCommand.js";
import { runInteractiveCityManager } from "@/city/shared/CityManager.js";
import { read_persisted_downcity_cli_locale } from "@/city/shared/DowncityConfigStore.js";
import { setCliVerbosity } from "@/shared/CliReporter.js";
import {
  helpText,
  langOptionText,
  resolveCliLocale,
  setCliLocale,
  t,
} from "@/shared/CliLocale.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const cli_path = join(__dirname, "../index.js");

const packageJson = JSON.parse(
  readFileSync(join(__dirname, "../../package.json"), "utf-8"),
) as { version: string };

/**
 * 解析当前执行命令的名称。
 *
 * 关键点（中文）
 * - 同一个二进制文件同时作为 `downcity` 与 `city` 暴露给操作系统。
 * - 根据 `process.argv[1]` 的 basename 决定对外显示的程序名，保证 help/version 与调用方式一致。
 */
function resolveInvokedName(): string {
  return process.argv[1]
    ? process.argv[1].replace(/\\/g, "/").split("/").pop() || "downcity"
    : "downcity";
}

/**
 * 解析当前 downcity 安装所绑定的 agent runtime 版本号。
 *
 * 关键点（中文）
 * - 这里读取的是 downcity 当前安装依赖中的 `@downcity/agent` 版本，
 *   不是 workspace 源码目录里的 package.json。
 * - 这样 `downcity agent -v` 才能反映"这份 downcity CLI 实际会驱动哪个 agent runtime"。
 */
function resolveInstalledAgentVersion(): string {
  const candidate_package_paths = [
    // 关键点（中文）：downcity 聚合包会把依赖放在 package root/node_modules。
    join(__dirname, "../../node_modules/@downcity/agent/package.json"),
    // 关键点（中文）：workspace 开发态的旧布局兜底，便于本地调试。
    join(__dirname, "../../../agent/package.json"),
  ];

  for (const package_path of candidate_package_paths) {
    try {
      const agentPackageJson = JSON.parse(
        readFileSync(package_path, "utf-8"),
      ) as { version?: string };
      const version = String(agentPackageJson.version || "").trim();
      return version || "unknown";
    } catch {
      // 关键点（中文）：继续尝试下一个布局候选，不把版本读取失败变成命令启动失败。
    }
  }

  return "unknown";
}

/**
 * 注册 downcity 子命令到给定的 commander 命令组。
 *
 * 关键点（中文）
 * - 将本机 City 容器所需的全部子命令注册到传入的 program 上。
 * - 子命令实现统一放在 `src/city/command/`，本函数只负责装配。
 */
export function registerCityCommands(program: Command): void {
  const installedAgentVersion = resolveInstalledAgentVersion();
  registerGatewayCommands(program, {
    version: packageJson.version,
    cliPath: cli_path,
  });
  registerAgentCommands(program, {
    version: packageJson.version,
    agentVersion: installedAgentVersion,
    hiddenPortOption: Option,
  });
  registerPluginsCommand(program);
  register_web_command(program);

  program.showHelpAfterError();
  program.showSuggestionAfterError();
}

/**
 * 执行 downcity CLI。
 *
 * 关键点（中文）
 * - 当用户执行 `downcity` 或 `city` 命令时调用。
 * - 无参数时进入全屏交互式 City 管理界面。
 */
export async function runDowncityCli(): Promise<void> {
  const program = new Command();
  const argv = process.argv.slice(2);
  const invoked_name = resolveInvokedName();
  const cli_locale = resolveCliLocale({
    argv,
    persisted_locale: read_persisted_downcity_cli_locale(),
  });
  setCliLocale(cli_locale);

  program
    .name(invoked_name)
    .description(t({
      zh: "管理本机 Agent、全局配置与 Federation 连接",
      en: "manage local agents, global config, and Federation connections",
    }))
    .version(packageJson.version, "-v, --version");

  program.helpOption("--help", helpText());
  program.option("--lang <locale>", langOptionText());
  program.option("-q, --quiet", t({
    zh: "仅输出错误信息",
    en: "only print error output",
  }));
  program.option("--verbose", t({
    zh: "输出详细进度",
    en: "print verbose progress output",
  }));

  registerCityCommands(program);

  /**
   * 处理 `downcity agent -v/--version`。
   *
   * 关键点（中文）
   * - commander 根命令会优先消费全局 `-v`，导致 `downcity agent -v` 默认只显示 CLI 版本。
   * - 这里在 parse 前做一次显式分流，确保 agent 命令能返回双版本信息。
   */
  if (
    argv[0] === "agent" &&
    argv.length === 2 &&
    (argv[1] === "-v" || argv[1] === "--version")
  ) {
    const installedAgentVersion = resolveInstalledAgentVersion();
    console.log(`${invoked_name} ${packageJson.version} (agent ${installedAgentVersion})`);
    process.exit(0);
  }

  if (process.argv.length <= 2) {
    await runInteractiveCityManager({
      program,
    });
    process.exit(0);
  }

  // 关键点（中文）：在 parse 前解析 --quiet / --verbose，设置全局 verbosity。
  program.hook("preAction", (thisCommand) => {
    const opts = thisCommand.optsWithGlobals<{ quiet?: boolean; verbose?: boolean }>();
    if (opts.quiet) setCliVerbosity("quiet");
    else if (opts.verbose) setCliVerbosity("verbose");
  });

  await program.parseAsync();
}
