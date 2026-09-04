/**
 * Cloudflare account 解析器。
 *
 * 关键点（中文）
 * - `fed deploy` 面向 Federation 项目，不要求用户理解 Wrangler 的登录细节。
 * - 有明确 account id 时直接复用；没有时先尝试 Wrangler 自动识别。
 * - Wrangler 已登录但无法枚举 account 时，进入最小交互：重新登录或手动输入 account id。
 */

import { isCancel, select, text } from "@/federation/tui/Prompts.js";
import { readCloudflareAccountId, writeCloudflareAccountId } from "@/federation/core/session.js";
import { emitCliBlock } from "@/shared/CliReporter.js";
import { CliError } from "@/shared/CliError.js";
import { runCommand } from "@/federation/deploy/runtime/CommandRunner.js";

/** Cloudflare account 解析参数。 */
export interface ResolveCloudflareAccountParams {
  /** City 项目目录。 */
  project_dir: string;
  /** 用户通过命令行或环境变量显式传入的 account id。 */
  account_id?: string;
}

/** Cloudflare account 解析结果。 */
export interface ResolveCloudflareAccountResult {
  /** Cloudflare account id。 */
  account_id?: string;
}

/**
 * 解析并准备 Cloudflare account。
 */
export async function resolveCloudflareAccount(
  params: ResolveCloudflareAccountParams,
): Promise<ResolveCloudflareAccountResult> {
  const initial_account_id = normalizeAccountId(params.account_id)
    ?? normalizeAccountId(process.env.CLOUDFLARE_ACCOUNT_ID)
    ?? normalizeAccountId(readCloudflareAccountId());

  if (initial_account_id) {
    return persistCloudflareAccount(initial_account_id);
  }

  let output = await runWranglerWhoami(params.project_dir);
  if (isWranglerLoginRequired(output)) {
    await openWranglerLogin(params.project_dir);
    output = await runWranglerWhoami(params.project_dir);
  }

  const detected_account_id = extractAccountId(output);
  if (detected_account_id) {
    return persistCloudflareAccount(detected_account_id);
  }

  if (isWranglerAccountLookupDenied(output)) {
    return await resolveAccountAfterLookupDenied(params);
  }

  return {};
}

/**
 * 处理 Wrangler 已登录但无法列出 account 的场景。
 */
async function resolveAccountAfterLookupDenied(
  params: ResolveCloudflareAccountParams,
): Promise<ResolveCloudflareAccountResult> {
  if (!canPrompt()) {
    throw new CliError({
      title: "Cloudflare account required",
      note: "Wrangler credential exists, but Cloudflare rejected user/account lookup, so city cannot choose an account automatically.",
      fix: "Run `fed deploy --account-id <account_id>` or rerun in an interactive terminal.",
    });
  }

  emitCliBlock({
    tone: "warning",
    title: "Cloudflare account needed",
    note: "Wrangler is logged in, but Cloudflare rejected the account lookup. City can refresh login or you can enter the account id once.",
  });

  const action = await select({
    message: "Choose Cloudflare account setup",
    options: [
      {
        label: "Refresh Wrangler login",
        value: "refresh-login",
        hint: "Open browser login again",
      },
      {
        label: "Enter account id",
        value: "enter-account-id",
        hint: "Saved to local City CLI state",
      },
      {
        label: "Cancel deploy",
        value: "cancel",
      },
    ],
  });
  if (isCancel(action) || action === "cancel") {
    throw new CliError({
      title: "City deploy cancelled",
      note: "Cloudflare account was not selected.",
    });
  }

  if (action === "refresh-login") {
    await refreshWranglerLogin(params.project_dir);
    const output = await runWranglerWhoami(params.project_dir);
    const account_id = extractAccountId(output);
    if (account_id) {
      return persistCloudflareAccount(account_id);
    }
    return await promptForAccountId();
  }

  return await promptForAccountId();
}

/**
 * 交互式输入 Cloudflare account id。
 */
async function promptForAccountId(): Promise<ResolveCloudflareAccountResult> {
  const account_id = await text({
    message: "Cloudflare account id",
    placeholder: "32-character account id",
    validate(value) {
      return normalizeAccountId(value)
        ? undefined
        : "Enter a 32-character Cloudflare account id.";
    },
  });
  if (isCancel(account_id)) {
    throw new CliError({
      title: "City deploy cancelled",
      note: "Cloudflare account id was not provided.",
    });
  }
  return persistCloudflareAccount(String(account_id));
}

/**
 * 保存 Cloudflare account id 到本地 City CLI 状态。
 */
function persistCloudflareAccount(account_id: string): ResolveCloudflareAccountResult {
  const normalized_account_id = normalizeAccountId(account_id);
  if (!normalized_account_id) {
    throw new CliError({
      title: "Invalid Cloudflare account id",
      note: "Cloudflare account id should be 32 hexadecimal characters.",
    });
  }

  writeCloudflareAccountId(normalized_account_id);
  return {
    account_id: normalized_account_id,
  };
}

/**
 * 打开 Wrangler 登录。
 */
async function openWranglerLogin(project_dir: string): Promise<void> {
  emitCliBlock({
    tone: "warning",
    title: "Cloudflare login required",
    note: "Opening Wrangler login before deploying this City.",
  });
  await runCommand({
    label: "Wrangler login",
    command: "pnpm exec wrangler login",
    cwd: project_dir,
  });
}

/**
 * 刷新 Wrangler 登录。
 */
async function refreshWranglerLogin(project_dir: string): Promise<void> {
  await runCommand({
    label: "Wrangler logout",
    command: "pnpm exec wrangler logout",
    cwd: project_dir,
  });
  await openWranglerLogin(project_dir);
}

/**
 * 执行 Wrangler whoami。
 */
async function runWranglerWhoami(project_dir: string): Promise<string> {
  try {
    return await runCommand({
      label: "Wrangler identity check",
      command: "pnpm exec wrangler whoami",
      cwd: project_dir,
      capture: true,
    });
  } catch (error) {
    if (error instanceof CliError) {
      return error.note ?? error.message;
    }
    throw error;
  }
}

/**
 * 判断当前进程是否可以进行交互。
 */
function canPrompt(): boolean {
  return process.stdin.isTTY === true && process.stdout.isTTY === true;
}

/**
 * 规范化 Cloudflare account id。
 */
function normalizeAccountId(value: string | undefined): string | undefined {
  const normalized = String(value || "").trim();
  return /^[0-9a-f]{32}$/i.test(normalized) ? normalized : undefined;
}

/**
 * 判断 Wrangler 是否需要登录。
 */
function isWranglerLoginRequired(output: string): boolean {
  return /not authenticated|not logged in|please login|authentication required/i.test(output);
}

/**
 * 判断 Wrangler 是否因 account lookup 权限失败。
 */
function isWranglerAccountLookupDenied(output: string): boolean {
  return /failed to automatically retrieve account ids|user account fetch permission denied|incorrect permissions/i.test(output);
}

/**
 * 从 Wrangler whoami 输出中提取 account id。
 */
function extractAccountId(output: string): string | undefined {
  return output.match(/[0-9a-f]{32}/i)?.[0];
}
