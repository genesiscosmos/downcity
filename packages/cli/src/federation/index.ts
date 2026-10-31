#!/usr/bin/env node

/**
 * downfed CLI 根命令装配模块。
 *
 * 关键点（中文）
 * - `downfed` 是 Federation 管理器，负责部署、Bureau 身份、机器凭证与服务资源。
 * - 默认无参数时打开交互式 Federation 管理界面。
 * - 本模块承载 Federation commander 根命令，`src/index.ts` 只负责按命令名分发。
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Command } from "commander";
import { runFederationApp } from "@/federation/app.js";
import { readPersistedCliLocale } from "@/federation/core/session.js";
import { createVersionBanner } from "@/shared/IndexSupport.js";
import { setCliVerbosity } from "@/shared/CliReporter.js";
import { deploy_federation_project, type FederationDeployCommandOptions } from "@/federation/deploy/commands/deploy.js";
import { create_federation_project, type FederationCreateCommandOptions } from "@/federation/create/commands/create.js";
import { run_federation_query_command } from "@/federation/query/commands/query.js";
import { prompt_add_federation_server } from "@/federation/server/FederationServerManager.js";
import { resolve_federation_target, type FederationTargetOptions } from "@/federation/server/FederationTarget.js";
import { run_federation_instance_command } from "@/federation/server/FederationInstanceCommands.js";
import { run_federation_clean, type FederationCleanOptions } from "@/federation/deploy/release/LocalReleaseCleaner.js";
import { open_federation_server_workspace } from "@/federation/server/FederationServerWorkspace.js";
import { CliError } from "@/shared/CliError.js";
import { helpText, langOptionText, resolveCliLocale, setCliLocale, t } from "@/shared/CliLocale.js";
import {
  issue_federation_bureau_token,
  list_federation_bureaus,
  revoke_federation_bureau,
} from "@/federation/bureau/commands/bureau.js";
import { run_interactive_bureau_token_manager } from "@/federation/bureau/InteractiveBureauTokenManager.js";
import { run_federation_web } from "@/federation/web/FederationWebCommand.js";
import type { FederationWebOptions } from "@/federation/types/FederationWeb.js";
import type { FederationQueryCommandOptions } from "@/federation/types/FederationQuery.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const packageJson = JSON.parse(
  readFileSync(join(__dirname, "../../package.json"), "utf-8"),
) as { version: string };

/**
 * 执行 downfed CLI。
 */
export async function runDownfedCli(): Promise<void> {
  const program = new Command();
  const argv = process.argv.slice(2);
  const cli_locale = resolveCliLocale({
    argv,
    persisted_locale: readPersistedCliLocale(),
  });
  setCliLocale(cli_locale);

  program
    .name("downfed")
    .description(t({
      zh: "Downcity Federation CLI — 管理 Federation、Bureau 身份与服务资源",
      en: "Downcity Federation CLI — manage Federation, Bureau identities, and service resources",
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

  program
    .command("manage")
    .description(t({
      zh: "选择本次 Federation 并打开管理工作区",
      en: "select a Federation and open its management workspace",
    }))
    .option("--id <id>", "Federation ID (exact match)")
    .option("--name <name>", "Federation name (exact match)")
    .helpOption("--help", helpText())
    .action(createVersionBanner(packageJson.version, async (options: FederationTargetOptions) => {
      await manage_federation_server(options);
    }));

  const server_program = program
    .command("server")
    .description(t({
      zh: "配置并管理已部署 Federation",
      en: "configure and manage deployed Federations",
    }))
    .option("--id <id>", "Federation ID (exact match)")
    .option("--name <name>", "Federation name (exact match)")
    .helpOption("--help", helpText())
    .action(createVersionBanner(packageJson.version, async (options: FederationTargetOptions) => {
      await manage_federation_server(options);
    }));

  server_program
    .command("manage")
    .description(t({
      zh: "选择本次 Federation 并进入 admin 管理工作区",
      en: "select a Federation and open its admin workspace for this operation",
    }))
    .option("--id <id>", "Federation ID (exact match)")
    .option("--name <name>", "Federation name (exact match)")
    .helpOption("--help", helpText())
    .action(createVersionBanner(packageJson.version, async (_options: FederationTargetOptions, command: Command) => {
      await manage_federation_server(command.optsWithGlobals<FederationTargetOptions>());
    }));

  register_bureau_commands(program);

  program
    .command("web")
    .description(t({
      zh: "选择本次 Federation 并启动本地 Web 管理 UI",
      en: "select a Federation and start its local Web admin UI",
    }))
    .option("--host <host>", t({ zh: "本地监听地址（仅 loopback）", en: "local listen host (loopback only)" }), "127.0.0.1")
    .option("--port <port>", t({ zh: "本地监听端口", en: "local listen port" }), "43128")
    .option("--no-open", t({ zh: "不自动打开浏览器", en: "do not open the browser automatically" }))
    .option("--id <id>", "Federation ID (exact match)")
    .option("--name <name>", "Federation name (exact match)")
    .helpOption("--help", helpText())
    .action(createVersionBanner(packageJson.version, async (options: Omit<FederationWebOptions, "port"> & {
      /** Commander 接收的本地 Web UI 端口字符串，校验后转换为整数。 */
      port: string;
    }) => {
      const port = Number(options.port);
      if (!Number.isInteger(port) || port < 0 || port > 65535) {
        throw new CliError({ title: "--port 必须是 0 到 65535 之间的整数。" });
      }
      try {
        await run_federation_web({
          host: options.host.trim(),
          port,
          open: options.open,
          id: options.id,
          name: options.name,
        });
      } catch (error) {
        if (error instanceof CliError) throw error;
        throw new CliError({
          title: "无法启动 Federation Web UI。",
          note: error instanceof Error ? error.message : String(error),
          fix: "确认当前 Federation 与本地监听端口可用。",
        });
      }
    }));

  server_program
    .command("add")
    .description(t({
      zh: "添加已部署 Federation URL",
      en: "add a deployed Federation URL",
    }))
    .helpOption("--help", helpText())
    .action(createVersionBanner(packageJson.version, async () => {
      await prompt_add_federation_server();
    }));

  register_root_federation_query_command(program);

  program
    .command("create")
    .option("--path <path>", t({ zh: "创建路径，默认当前路径", en: "project path; defaults to the current path" }), ".")
    .description(t({
      zh: "交互式创建 Federation 项目骨架",
      en: "interactively scaffold a Federation project",
    }))
    .option("-f, --force", t({
      zh: "允许覆盖已有项目文件",
      en: "allow overwriting existing project files",
    }))
    .option("--template <template>", t({
      zh: "内置模板 ID 或 Git 模板 URL",
      en: "built-in template ID or Git template URL",
    }))
    .helpOption("--help", helpText())
    .action(createVersionBanner(packageJson.version, async (
      options: FederationCreateCommandOptions & {
        /** 本次创建目录，缺省为当前路径。 */
        path: string;
      },
    ) => {
      await create_federation_project(options.path, options);
    }));

  program
    .command("deploy")
    .option("--path <path>", t({ zh: "项目路径，默认当前路径", en: "project path; defaults to the current path" }), ".")
    .description(t({
      zh: "部署当前目录或本地目录中的 Federation 项目",
      en: "deploy a Federation project from the current directory or a local path",
    }))
    .option("--dry-run", t({
      zh: "只验证构建和部署配置，不启动或发布",
      en: "validate build and deployment config without starting or publishing",
    }))
    .option("--verify", t({
      zh: "部署完成后请求 Federation /health",
      en: "request Federation /health after deployment completes",
    }))
    .option("--verify-only", t({
      zh: "只验证当前 Fed 已登记实例的 /health",
      en: "verify the registered instance for the current Fed",
    }))
    .option("--skip-build", t({
      zh: "跳过 package.json 中的 build",
      en: "skip the package.json build script",
    }))
    .option("--skip-typecheck", t({
      zh: "跳过 package.json 中的 typecheck",
      en: "skip the package.json typecheck script",
    }))
    .option("--account-id <account_id>", t({
      zh: "本次部署使用的 Cloudflare account id",
      en: "use this Cloudflare account id for the deployment",
    }))
    .option("--admin-reset", t({
      zh: "使用基础设施部署权限重置管理员并撤销旧会话",
      en: "reset the administrator using infrastructure deployment authority",
    }))
    .option("--yes", t({
      zh: "确认具有破坏性的管理员重置（用于非交互环境）",
      en: "confirm destructive administrator reset in non-interactive environments",
    }))
    .helpOption("--help", helpText())
    .action(createVersionBanner(packageJson.version, async (
      options: FederationDeployCommandOptions & {
        /** 本次部署项目目录，缺省为当前路径。 */
        path: string;
      },
    ) => {
      await deploy_federation_project(options.path, options);
    }, "Downcity CLI"));

  register_instance_commands(program);
  program.command("clean")
    .description(t({ zh: "预览并清理本地发布产物，保留最近三个成功版本与所有受保护引用", en: "preview and clean local releases, retaining the latest three successful versions and protected references" }))
    .option("--id <id>", "Federation ID (exact match)")
    .option("--name <name>", "Federation name (exact match)")
    .option("--dry-run", t({ zh: "仅展示清理清单", en: "preview the cleanup plan without deleting" }))
    .option("--yes", t({ zh: "明确确认删除清单中的候选版本", en: "explicitly confirm deletion of listed release candidates" }))
    .helpOption("--help", helpText())
    .action(createVersionBanner(packageJson.version, async (options: FederationTargetOptions & {
      /** Commander 读取的只读预览开关。 */
      dryRun?: boolean;
      /** 用户显式确认删除。 */
      yes?: boolean;
    }) => {
      const clean_options: FederationCleanOptions = { id: options.id, name: options.name, dry_run: options.dryRun, yes: options.yes };
      await run_federation_clean(clean_options);
    }));

  program.hook("preAction", (thisCommand) => {
    const opts = thisCommand.optsWithGlobals<{ quiet?: boolean; verbose?: boolean }>();
    if (opts.quiet) setCliVerbosity("quiet");
    else if (opts.verbose) setCliVerbosity("verbose");
  });

  program.showHelpAfterError();
  program.showSuggestionAfterError();

  if (process.argv.length <= 2) {
    if (!process.stdin.isTTY || !process.stdout.isTTY) {
      throw new CliError({ title: "Interactive Federation management requires a terminal", fix: "Use fed --help for explicit commands." });
    }
    await runFederationApp([]);
    process.exit(0);
  }

  await program.parseAsync(process.argv);
}

/** 为已有实例提供单次定位的基本生命周期与诊断命令。 */
function register_instance_commands(program: Command): void {
  for (const action of ["status", "logs", "stop", "restart"] as const) {
    const descriptions = {
      status: { zh: "查看本次实例的登记状态与健康情况", en: "inspect an instance record and health" },
      logs: { zh: "读取本次本地实例的最近日志", en: "read recent logs of a local instance" },
      stop: { zh: "停止本次本地受管实例", en: "stop a managed local instance" },
      restart: { zh: "按保存的启动配置重启本次本地实例", en: "restart a local instance using its saved launch configuration" },
    };
    program.command(action)
      .description(t(descriptions[action]))
      .option("--id <id>", "Federation ID (exact match)")
      .option("--name <name>", "Federation name (exact match)")
      .helpOption("--help", helpText())
      .action(createVersionBanner(packageJson.version, async (options: FederationTargetOptions) => {
        await run_federation_instance_command(action, options);
      }));
  }
}

/** 注册 Federation Bureau 注册表命令。 */
function register_bureau_commands(program: Command): void {
  const bureau_program = program
    .command("bureau")
    .description(t({
      zh: "管理本次指定 Federation 的 Bureau 注册表",
      en: "manage Bureau registrations for this operation's Federation",
    }))
    .helpOption("--help", helpText());

  const token_program = bureau_program
    .command("token")
    .description(t({
      zh: "交互式管理 Bureau Token",
      en: "interactively manage Bureau tokens",
    }))
    .option("--id <id>", "Federation ID (exact match)")
    .option("--name <name>", "Federation name (exact match)")
    .helpOption("--help", helpText())
    .action(createVersionBanner(packageJson.version, async (options: FederationTargetOptions) => {
      await run_interactive_bureau_token_manager(options);
    }));

  token_program
    .command("issue <bureau_id>")
    .description(t({ zh: "签发 Bureau Token", en: "issue a Bureau token" }))
    .helpOption("--help", helpText())
    .action(createVersionBanner(packageJson.version, async (bureau_id: string, _options: unknown, command: Command) => {
      await issue_federation_bureau_token(bureau_id, command.optsWithGlobals<FederationTargetOptions>());
    }));

  token_program
    .command("list")
    .description(t({ zh: "列出 Bureau 注册记录", en: "list Bureau registrations" }))
    .helpOption("--help", helpText())
    .action(createVersionBanner(packageJson.version, async (_options: unknown, command: Command) => {
      await list_federation_bureaus(command.optsWithGlobals<FederationTargetOptions>());
    }));

  token_program
    .command("revoke <token_id>")
    .description(t({ zh: "撤销 Bureau Token", en: "revoke a Bureau token" }))
    .helpOption("--help", helpText())
    .action(createVersionBanner(packageJson.version, async (token_id: string, _options: unknown, command: Command) => {
      await revoke_federation_bureau(token_id, command.optsWithGlobals<FederationTargetOptions>());
    }));
}

/** 打开本次显式指定或交互选择的 Federation 管理工作区。 */
async function manage_federation_server(options: FederationTargetOptions = {}): Promise<void> {
  const server = await resolve_federation_target(options);
  if (!server) return;
  await open_federation_server_workspace(server.base_url);
}

function register_root_federation_query_command(program: Command): void {
  program
    .command("query <method> <path>")
    .description(t({
      zh: "请求本次指定的 Federation HTTP API",
      en: "query the HTTP API of a Federation selected for this operation",
    }))
    .option("--id <id>", "Federation ID (exact match)")
    .option("--name <name>", "Federation name (exact match)")
    .option("--raw", t({
      zh: "只输出原始响应 body",
      en: "print the raw response body only",
    }))
    .option("--header <header>", t({
      zh: "临时请求头，格式 key:value，可重复使用",
      en: "temporary request header in key:value format; repeatable",
    }), collect_query_header, [] as string[])
    .option("-d, --data <json>", t({
      zh: "JSON 字符串请求体",
      en: "JSON string request body",
    }))
    .option("--file <path>", t({
      zh: "从文件读取 JSON 请求体",
      en: "read JSON request body from a file",
    }))
    .helpOption("--help", helpText())
    .action(async (
      method: string,
      path: string,
      options: FederationQueryCommandOptions,
    ) => {
      try {
        await run_federation_query_command(method, path, options);
      } catch (error) {
        if (error instanceof CliError) {
          render_query_cli_error(error);
          process.exitCode = error.exitCode;
          return;
        }
        throw error;
      }
    });
}

function collect_query_header(value: string, previous: string[]): string[] {
  return [...previous, value];
}

function render_query_cli_error(error: CliError): void {
  console.error(error.message);
  if (error.note) console.error(error.note);
  if (error.fix) console.error(`fix: ${error.fix}`);
}
