/**
 * Federation 管理员部署 provisioning 模块。
 *
 * CLI 只在内存中持有一次性明文密码，部署目标只接收密码摘要。候选凭证必须通过
 * 远端登录验证后才能展示，避免对已有数据库错误展示一组无效凭证。
 */

import {
  create_federation_admin_credentials,
  create_federation_admin_password_hash,
  type FederationAdminProvisioning,
} from "@downcity/city";
import { randomUUID } from "node:crypto";
import { emitCliBlock } from "@/shared/CliReporter.js";

/** 单次部署持有的管理员 provisioning 上下文。 */
export interface AdminProvisioningContext {
  /** 传给可信 Federation 宿主的无明文 provisioning。 */
  provisioning: FederationAdminProvisioning;
  /** 仅在验证成功后一次性展示的明文密码。 */
  password: string;
}

/** 创建首次初始化候选或显式灾难恢复 provisioning。 */
export async function create_admin_provisioning(
  mode: FederationAdminProvisioning["mode"],
): Promise<AdminProvisioningContext> {
  const credentials = create_federation_admin_credentials();
  return {
    provisioning: {
      mode,
      provision_id: `fap_${randomUUID().replace(/-/gu, "")}`,
      admin_id: credentials.admin_id,
      password_hash: await create_federation_admin_password_hash(credentials.password),
    },
    password: credentials.password,
  };
}

/** 验证候选凭证是否真正成为目标 Federation 的管理员，并立即撤销探测会话。 */
export async function verify_admin_provisioning(
  base_url: string,
  context: AdminProvisioningContext,
): Promise<boolean> {
  const response = await fetch(`${base_url.replace(/\/+$/gu, "")}/v1/admin/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      admin_id: context.provisioning.admin_id,
      password: context.password,
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

/** 在部署完全成功后一次性展示管理员凭证。 */
export function show_admin_credentials_once(context: AdminProvisioningContext): void {
  emitCliBlock({
    tone: "accent",
    title: "Federation Administrator · shown once",
    facts: [
      { label: "admin id", value: context.provisioning.admin_id },
      { label: "password", value: context.password },
    ],
    note: "Save this password now. Downcity does not store it and cannot display it again.",
  });
}
