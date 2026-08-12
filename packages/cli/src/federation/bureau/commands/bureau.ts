/**
 * Federation Bureau 注册表命令。
 *
 * `token issue` 通过当前 active Federation 的 Admin Session 请求 Federation
 * 签发长期机器凭证。`token list` 与 `token revoke` 管理凭证生命周期。
 */

import {
  EmbassyAdmin,
  type BureauTokenIssueResult,
  type BureauTokenSummary,
} from "@downcity/federation";
import { readActiveServer, type ServerProfile } from "@/federation/core/session.js";
import { isCancel, text } from "@/federation/tui/Prompts.js";
import { CliError } from "@/shared/CliError.js";
import { emitCliBlock, emitCliList } from "@/shared/CliReporter.js";
import { t } from "@/shared/CliLocale.js";

/** 为当前 active Federation 签发 Bureau Token。 */
export async function issue_federation_bureau_token(bureau_id_input: string): Promise<void> {
  const bureau_id = require_bureau_id(bureau_id_input);
  const purpose_input = await text({
    message: t({ zh: "Token 用途", en: "Token purpose" }),
    placeholder: t({ zh: "例如：生产环境支付服务", en: "For example: production payments service" }),
    validate: validate_bureau_token_purpose,
  });
  if (isCancel(purpose_input)) return;

  const issued = await issue_federation_bureau_token_record(bureau_id, String(purpose_input));
  render_issued_federation_bureau_token(issued);
}

/** 请求 Federation 签发 Bureau Token，返回仅供当前进程展示的一次性明文。 */
export async function issue_federation_bureau_token_record(
  bureau_id_input: string,
  purpose_input: string,
): Promise<BureauTokenIssueResult & { federation_url: string }> {
  const server = require_active_admin_server();
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
  issued: BureauTokenIssueResult & { federation_url: string },
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

/** 列出当前 active Federation 的 Bureau 注册记录。 */
export async function list_federation_bureaus(): Promise<void> {
  const items = await read_federation_bureau_tokens();
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

/** 撤销当前 active Federation 中的 Bureau 注册记录。 */
export async function revoke_federation_bureau(token_id_input: string): Promise<void> {
  const token_id = require_value(token_id_input, "token_id");
  await revoke_federation_bureau_token_record(token_id);
  emitCliBlock({
    tone: "success",
    title: t({ zh: "Bureau 已撤销", en: "Bureau revoked" }),
    facts: [{ label: "Token ID", value: token_id }],
  });
}

/** 读取当前 active Federation 的 Bureau Token 元数据。 */
export async function read_federation_bureau_tokens(): Promise<BureauTokenSummary[]> {
  const server = require_active_admin_server();
  return await create_federation_admin(server).bureaus.tokens.list();
}

/** 撤销当前 active Federation 中的 Bureau Token 记录。 */
export async function revoke_federation_bureau_token_record(token_id_input: string): Promise<void> {
  const server = require_active_admin_server();
  const token_id = require_value(token_id_input, "token_id");
  await create_federation_admin(server).bureaus.tokens.revoke(token_id);
}

function require_active_admin_server(): ServerProfile {
  const server = readActiveServer();
  if (!server) {
    throw new CliError({
      title: t({ zh: "当前没有 active Federation。", en: "No active Federation is configured." }),
      fix: "fed server add",
    });
  }
  if (!server.admin_session_token?.trim() || Date.parse(server.admin_session_expires_at ?? "") <= Date.now()) {
    throw new CliError({
      title: t({
        zh: "当前 Federation 需要管理员登录。",
        en: "Administrator login is required for the active Federation.",
      }),
      fix: "fed server manage",
    });
  }
  return server;
}

function create_federation_admin(server: ServerProfile): EmbassyAdmin {
  return new EmbassyAdmin({
    federation_url: server.base_url,
    admin_token: server.admin_session_token!,
  });
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
