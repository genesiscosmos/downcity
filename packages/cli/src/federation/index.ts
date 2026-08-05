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
import { deploy_federation_project } from "@/federation/deploy/commands/deploy.js";
import { create_federation_project } from "@/federation/create/commands/create.js";
import { run_federation_query_command } from "@/federation/query/commands/query.js";
import { readActiveServer } from "@/federation/core/session.js";
import {
  prompt_add_federation_server,
  prompt_select_active_federation_server,
} from "@/federation/server/FederationServerManager.js";
import { open_federation_server_workspace } from "@/federation/server/FederationServerWorkspace.js";
import { CliError } from "@/shared/CliError.js";
import { helpText, langOptionText, resolveCliLocale, setCliLocale, t } from "@/shared/CliLocale.js";
import {
  create_federation_bureau_token,
  list_federation_bureaus,
  revoke_federation_bureau,
} from "@/federation/bureau/commands/bureau.js";
import { run_interactive_bureau_token_manager } from "@/federation/bureau/InteractiveBureauTokenManager.js";
import { run_federation_web } from "@/federation/web/FederationWebCommand.js";

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
    .command("manage [action]")
    .description(t({
      zh: "打开 Federation 交互式管理界面",
      en: "open the interactive Federation management interface",
    }))
    .helpOption("--help", helpText())
    .action(createVersionBanner(packageJson.version, async (action?: string) => {
      await runFederationApp(action ? [action] : []);
    }));

  const server_program = program
    .command("server")
    .description(t({
      zh: "配置并管理已部署 Federation",
      en: "configure and manage deployed Federations",
    }))
    .helpOption("--help", helpText())
    .action(createVersionBanner(packageJson.version, async () => {
      await manage_federation_server();
    }));

  server_program
    .command("manage")
    .description(t({
      zh: "进入当前或已选择 Federation 的 admin 管理工作区",
      en: "open the admin workspace for the current or selected Federation",
    }))
    .helpOption("--help", helpText())
    .action(createVersionBanner(packageJson.version, async () => {
      await manage_federation_server();
    }));

  register_bureau_commands(program);

  program
    .command("web")
    .description(t({
      zh: "启动当前 Federation 的本地 Web 管理 UI",
      en: "start the local Web admin UI for a Federation",
    }))
    .option("--host <host>", t({ zh: "本地监听地址（仅 loopback）", en: "local listen host (loopback only)" }), "127.0.0.1")
    .option("--port <port>", t({ zh: "本地监听端口", en: "local listen port" }), "43128")
    .option("--no-open", t({ zh: "不自动打开浏览器", en: "do not open the browser automatically" }))
    .option("--federation <name-or-url>", t({ zh: "指定 Federation 名称或 URL", en: "select a Federation by name or URL" }))
    .helpOption("--help", helpText())
    .action(createVersionBanner(packageJson.version, async (options: {
      host: string;
      port: string;
      open: boolean;
      federation?: string;
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
          federation: options.federation,
        });
      } catch (error) {
        if (error instanceof CliError) throw error;
        throw new CliError({
          title: "无法启动 Federation Web UI。",
          note: error instanceof Error ? error.message : String(error),
          fix: "确认当前 Federation、admin_secret_key 与本地监听端口可用。",
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
    .command("create [dir]")
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
      dir: string | undefined,
      options: { force?: boolean; template?: string },
    ) => {
      await create_federation_project(dir ?? ".", options);
    }));

  program
    .command("deploy [source]")
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
    .helpOption("--help", helpText())
    .action(createVersionBanner(packageJson.version, async (
      source: string | undefined,
      options: {
        dryRun?: boolean;
        verify?: boolean;
        verifyOnly?: boolean;
        skipBuild?: boolean;
        skipTypecheck?: boolean;
        accountId?: string;
      },
    ) => {
      await deploy_federation_project(source ?? ".", options);
    }, "Downcity CLI"));

  program.hook("preAction", (thisCommand) => {
    const opts = thisCommand.optsWithGlobals<{ quiet?: boolean; verbose?: boolean }>();
    if (opts.quiet) setCliVerbosity("quiet");
    else if (opts.verbose) setCliVerbosity("verbose");
  });

  program.showHelpAfterError();
  program.showSuggestionAfterError();

  if (process.argv.length <= 2) {
    await runFederationApp([]);
    process.exit(0);
  }

  await program.parseAsync(process.argv);
}

/** 注册 Federation Bureau 注册表命令。 */
function register_bureau_commands(program: Command): void {
  const bureau_program = program
    .command("bureau")
    .description(t({
      zh: "管理当前 Federation 的 Bureau 注册表",
      en: "manage the active Federation Bureau registry",
    }))
    .helpOption("--help", helpText());

  const token_program = bureau_program
    .command("token")
    .description(t({
      zh: "交互式管理 Bureau Token",
      en: "interactively manage Bureau tokens",
    }))
    .helpOption("--help", helpText())
    .action(createVersionBanner(packageJson.version, async () => {
      await run_interactive_bureau_token_manager();
    }));

  token_program
    .command("create <bureau_id>")
    .description(t({ zh: "创建并登记 Bureau Token", en: "create and register a Bureau token" }))
    .helpOption("--help", helpText())
    .action(createVersionBanner(packageJson.version, create_federation_bureau_token));

  token_program
    .command("list")
    .description(t({ zh: "列出 Bureau 注册记录", en: "list Bureau registrations" }))
    .helpOption("--help", helpText())
    .action(createVersionBanner(packageJson.version, list_federation_bureaus));

  token_program
    .command("revoke <token_id>")
    .description(t({ zh: "撤销 Bureau Token", en: "revoke a Bureau token" }))
    .helpOption("--help", helpText())
    .action(createVersionBanner(packageJson.version, revoke_federation_bureau));
}

/** 打开当前或交互选择后的 Federation 管理工作区。 */
async function manage_federation_server(): Promise<void> {
  const server = readActiveServer()
    ?? await prompt_select_active_federation_server()
    ?? await prompt_add_federation_server();
  if (!server) return;
  await open_federation_server_workspace(server.base_url);
}

function register_root_federation_query_command(program: Command): void {
  program
    .command("query <method> <path>")
    .description(t({
      zh: "请求当前 active Federation 的 HTTP API",
      en: "query the HTTP API of the active Federation",
    }))
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
      options: {
        raw?: boolean;
        header?: string[];
        data?: string;
        file?: string;
      },
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
