/**
 * Federation Bureau 注册表命令。
 *
 * CLI 入口仅解析一次本次目标，底层 record 函数显式接收实例配置。
 * `token issue` 通过选定实例的 Admin Session 签发长期机器凭证，
 * `token list` 与 `token revoke` 管理凭证生命周期。
 */

import {
  Federation,
  type FederationAdmin,
  type BureauTokenIssueResult,
  type BureauTokenSummary,
} from "@downcity/federation";
import type { ServerProfile } from "@/federation/core/session.js";
import {
  resolve_federation_target,
  type FederationTargetOptions,
} from "@/federation/server/FederationTarget.js";
import { isCancel, text } from "@/federation/tui/Prompts.js";
import { CliError } from "@/shared/CliError.js";
import { emitCliBlock, emitCliList } from "@/shared/CliReporter.js";
import { t } from "@/shared/CliLocale.js";

/** Bureau Token 签发结果，仅在当前进程保留一次性明文及目标 URL。 */
export interface FederationBureauTokenIssueRecord extends BureauTokenIssueResult {
  /** 签发该 Token 的 Federation 基础 URL，用于配置 Bureau 部署环境。 */
  federation_url: string;
}

/** 为本次选定的 Federation 签发 Bureau Token；取消目标选择时直接返回。 */
export async function issue_federation_bureau_token(
  bureau_id_input: string,
  options: FederationTargetOptions = {},
): Promise<void> {
  const server = await resolve_federation_target(options);
  if (!server) return;
  const bureau_id = require_bureau_id(bureau_id_input);
  const purpose_input = await text({
    message: t({ zh: "Token 用途", en: "Token purpose" }),
    placeholder: t({ zh: "例如：生产环境支付服务", en: "For example: production payments service" }),
    validate: validate_bureau_token_purpose,
  });
  if (isCancel(purpose_input)) return;

  const issued = await issue_federation_bureau_token_record(server, bureau_id, String(purpose_input));
  render_issued_federation_bureau_token(issued);
}

/** 使用显式实例签发 Bureau Token，返回仅供当前进程展示的一次性明文。 */
export async function issue_federation_bureau_token_record(
  server: ServerProfile,
  bureau_id_input: string,
  purpose_input: string,
): Promise<FederationBureauTokenIssueRecord> {
  const bureau_id = require_bureau_id(bureau_id_input);
  const purpose = require_bureau_token_purpose(purpose_input);
  const admin = create_federation_admin(server);
  const issued = await admin.bureaus.tokens.issue({
    bureau_id,
    purpose,
  });

  return {
    ...issued,
    federation_url: server.base_url,
  };
}

/** 输出刚签发的 Bureau Token；明文不会再次从 Federation 读取。 */
function render_issued_federation_bureau_token(
  issued: FederationBureauTokenIssueRecord,
): void {
  emitCliBlock({
    tone: "success",
    title: t({ zh: "Bureau Token 已签发", en: "Bureau token issued" }),
    facts: [
      { label: "DOWNCITY_FEDERATION_URL", value: issued.federation_url },
      { label: "DOWNCITY_BUREAU_ID", value: issued.bureau_id },
      { label: t({ zh: "用途", en: "Purpose" }), value: issued.purpose },
      { label: "Token ID", value: issued.token_id },
      { label: "DOWNCITY_BUREAU_TOKEN", value: issued.bureau_token },
    ],
    note: t({
      zh: "Token 明文只显示这一次，请立即写入 Bureau 的部署环境变量。",
      en: "The plaintext token is shown only once. Store it in the Bureau deployment environment now.",
    }),
  });
}

/** 列出本次选定的 Federation 的 Bureau 注册记录。 */
export async function list_federation_bureaus(
  options: FederationTargetOptions = {},
): Promise<void> {
  const server = await resolve_federation_target(options);
  if (!server) return;
  const items = await read_federation_bureau_tokens(server);
  emitCliList({
    title: t({ zh: "Bureau 注册表", en: "Bureau registry" }),
    summary: t({ zh: `${items.length} 条`, en: `${items.length} items` }),
    items: items.map((item) => ({
      title: item.token_id,
      tone: item.status === "active" ? "success" : "warning",
      facts: [
        {
          label: t({ zh: "用途", en: "Purpose" }),
          value: item.purpose || t({ zh: "未说明", en: "Unspecified" }),
        },
        { label: t({ zh: "状态", en: "Status" }), value: item.status },
        { label: t({ zh: "创建时间", en: "Created" }), value: item.created_at },
      ],
    })),
  });
}

/** 撤销本次选定的 Federation 中的 Bureau 注册记录。 */
export async function revoke_federation_bureau(
  token_id_input: string,
  options: FederationTargetOptions = {},
): Promise<void> {
  const server = await resolve_federation_target(options);
  if (!server) return;
  const token_id = require_value(token_id_input, "token_id");
  await revoke_federation_bureau_token_record(server, token_id);
  emitCliBlock({
    tone: "success",
    title: t({ zh: "Bureau 已撤销", en: "Bureau revoked" }),
    facts: [{ label: "Token ID", value: token_id }],
  });
}

/** 读取显式实例的 Bureau Token 元数据，不执行目标选择。 */
export async function read_federation_bureau_tokens(
  server: ServerProfile,
): Promise<BureauTokenSummary[]> {
  return await create_federation_admin(server).bureaus.tokens.list();
}

/** 撤销显式实例中的 Bureau Token 记录，不执行目标选择。 */
export async function revoke_federation_bureau_token_record(
  server: ServerProfile,
  token_id_input: string,
): Promise<void> {
  const token_id = require_value(token_id_input, "token_id");
  await create_federation_admin(server).bureaus.tokens.revoke(token_id);
}

/** 校验显式实例的管理员 Session，并为该实例构造管理客户端。 */
function create_federation_admin(server: ServerProfile): FederationAdmin {
  if (!server.admin_session_token?.trim() || Date.parse(server.admin_session_expires_at ?? "") <= Date.now()) {
    throw new CliError({
      title: t({
        zh: "选定的 Federation 需要管理员登录。",
        en: "Administrator login is required for the selected Federation.",
      }),
      fix: server.fed_id
        ? `fed server manage --id ${JSON.stringify(server.fed_id)}`
        : `fed server manage --name ${JSON.stringify(server.name)}`,
    });
  }
  return new Federation({
    url: server.base_url,
    admin_token: server.admin_session_token!,
  }).admin;
}

function require_value(value: unknown, name: string): string {
  const normalized = String(value ?? "").trim();
  if (!normalized) {
    throw new CliError({ title: `${name} is required` });
  }
  return normalized;
}

/** 读取 opaque Bureau ID，不对调用方提供的值做任何改写。 */
function require_bureau_id(value: unknown): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new CliError({ title: "bureau_id is required" });
  }
  return value;
}

function validate_bureau_token_purpose(value: string): string | true {
  const purpose = value.trim();
  if (!purpose) {
    return t({ zh: "请输入 Token 用途", en: "Enter a token purpose" });
  }
  if (purpose.length > 200) {
    return t({
      zh: "Token 用途不能超过 200 个字符",
      en: "Token purpose must be at most 200 characters",
    });
  }
  return true;
}

function require_bureau_token_purpose(value: unknown): string {
  const purpose = require_value(value, "purpose");
  if (purpose.length > 200) {
    throw new CliError({
      title: t({
        zh: "Token 用途不能超过 200 个字符。",
        en: "Token purpose must be at most 200 characters.",
      }),
    });
  }
  return purpose;
}
