/**
 * Federation 管理员部署凭证模块。
 *
 * CLI 只在内存中持有一次性明文密码，数据库只接收 PBKDF2 编码摘要。候选凭证必须
 * 通过远端登录验证后才能展示，避免把未生效的密码交给用户。
 */

import {
  create_federation_admin_password_hash,
} from "@downcity/city";
import { randomUUID } from "node:crypto";
import { CliError } from "@/shared/CliError.js";
import { emitCliBlock } from "@/shared/CliReporter.js";
import { isCancel, password, text } from "@/federation/tui/Prompts.js";
import type {
  FederationAdminDatabaseMode,
  FederationAdminDeploymentCredentials,
} from "@/federation/types/FederationAdminDeployment.js";

/** 交互式收集首次初始化或显式恢复使用的管理员凭证。 */
export async function create_admin_deployment_credentials(
  mode: FederationAdminDatabaseMode,
): Promise<FederationAdminDeploymentCredentials> {
  const admin_id_result = await text({
    message: "管理员 ID",
    placeholder: "admin_owner",
    validate: validate_admin_id,
  });
  const admin_id = read_prompt_value(admin_id_result, "管理员 ID");
  const password_result = await password({
    message: "管理员密码（至少 12 个字符）",
    validate: validate_admin_password,
  });
  const plain_password = read_prompt_value(password_result, "管理员密码");
  const confirmation_result = await password({
    message: "再次输入管理员密码",
    validate: validate_admin_password,
  });
  const confirmation = read_prompt_value(confirmation_result, "管理员密码确认");
  if (plain_password !== confirmation) {
    throw new CliError({
      title: "管理员密码确认不一致",
      note: "两次输入的管理员密码必须完全一致。",
    });
  }
  return {
    mode,
    provision_id: `fap_${randomUUID().replace(/-/gu, "")}`,
    admin_id,
    password_hash: await create_federation_admin_password_hash(plain_password),
    password: plain_password,
  };
}

/** 验证候选凭证，并立即撤销验证产生的短期 Session。 */
export async function verify_admin_deployment_credentials(
  base_url: string,
  credentials: FederationAdminDeploymentCredentials,
): Promise<boolean> {
  const response = await fetch(`${base_url.replace(/\/+$/gu, "")}/v1/admin/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      admin_id: credentials.admin_id,
      password: credentials.password,
    }),
  });
  const response_text = await response.text();
  if (!response.ok) {
    throw new CliError({
      title: "Federation administrator verification failed",
      note: `Worker returned HTTP ${response.status}: ${response_text.slice(0, 500)}`,
    });
  }
  let body: { session_token?: unknown };
  try {
    body = JSON.parse(response_text) as { session_token?: unknown };
  } catch {
    throw new CliError({
      title: "Federation administrator verification failed",
      note: `Worker returned invalid JSON: ${response_text.slice(0, 500)}`,
    });
  }
  const session_token = typeof body.session_token === "string" ? body.session_token : "";
  if (!session_token) {
    throw new CliError({
      title: "Federation administrator verification failed",
      note: `Worker response did not include a session token: ${response_text.slice(0, 500)}`,
    });
  }
  await fetch(`${base_url.replace(/\/+$/gu, "")}/v1/admin/logout`, {
    method: "POST",
    headers: { authorization: `Bearer ${session_token}` },
  }).catch(() => undefined);
  return true;
}

/** 在部署和远端验证完全成功后提示管理员凭证已生效。 */
export function show_admin_credentials_configured(): void {
  emitCliBlock({
    tone: "accent",
    title: "Federation Administrator",
    facts: [{ label: "status", value: "configured" }],
    note: "管理员凭证由你在本次交互中设置。Downcity 不保存也不会再次显示密码。",
  });
}

/** 读取并规范化交互式文本结果。 */
function read_prompt_value(value: unknown, label: string): string {
  if (isCancel(value)) {
    throw new CliError({ title: "已取消管理员凭证设置。" });
  }
  const normalized_value = String(value ?? "").trim();
  if (!normalized_value) throw new CliError({ title: `${label}不能为空。` });
  return normalized_value;
}

/** 校验管理员 ID 的可持久化格式。 */
function validate_admin_id(value: string): string | true {
  const normalized_value = value.trim();
  if (!normalized_value) return "管理员 ID 不能为空。";
  if (normalized_value.length > 128) return "管理员 ID 不能超过 128 个字符。";
  if (!/^[A-Za-z0-9_-]+$/u.test(normalized_value)) {
    return "管理员 ID 只能包含字母、数字、下划线和短横线。";
  }
  return true;
}

/** 校验管理员密码长度与基本格式。 */
function validate_admin_password(value: string): string | true {
  if (value.length < 12) return "管理员密码至少需要 12 个字符。";
  if (value.length > 1024) return "管理员密码不能超过 1024 个字符。";
  return true;
}
