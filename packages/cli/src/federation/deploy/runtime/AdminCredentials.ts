/**
 * Federation 管理员部署凭证模块。
 *
 * CLI 只在内存中持有一次性明文密码，数据库只接收 PBKDF2 编码摘要。候选凭证必须
 * 通过远端登录验证后才能展示，避免把未生效的密码交给用户。
 */

import {
  create_federation_admin_credentials,
  create_federation_admin_password_hash,
} from "@downcity/city";
import { randomUUID } from "node:crypto";
import { emitCliBlock } from "@/shared/CliReporter.js";
import type {
  FederationAdminDatabaseMode,
  FederationAdminDeploymentCredentials,
} from "@/federation/types/FederationAdminDeployment.js";

/** 创建首次初始化候选或显式恢复凭证。 */
export async function create_admin_deployment_credentials(
  mode: FederationAdminDatabaseMode,
): Promise<FederationAdminDeploymentCredentials> {
  const credentials = create_federation_admin_credentials();
  return {
    mode,
    provision_id: `fap_${randomUUID().replace(/-/gu, "")}`,
    admin_id: credentials.admin_id,
    password_hash: await create_federation_admin_password_hash(credentials.password),
    password: credentials.password,
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
  if (!response.ok) return false;
  const body = await response.json() as { session_token?: unknown };
  const session_token = typeof body.session_token === "string" ? body.session_token : "";
  if (!session_token) return false;
  await fetch(`${base_url.replace(/\/+$/gu, "")}/v1/admin/logout`, {
    method: "POST",
    headers: { authorization: `Bearer ${session_token}` },
  }).catch(() => undefined);
  return true;
}

/** 在部署和远端验证完全成功后一次性展示管理员凭证。 */
export function show_admin_credentials_once(
  credentials: FederationAdminDeploymentCredentials,
): void {
  emitCliBlock({
    tone: "accent",
    title: "Federation Administrator · shown once",
    facts: [
      { label: "admin id", value: credentials.admin_id },
      { label: "password", value: credentials.password },
    ],
    note: "Save this password now. Downcity does not store it and cannot display it again.",
  });
}
