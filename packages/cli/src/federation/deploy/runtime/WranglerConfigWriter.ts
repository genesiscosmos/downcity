/**
 * Wrangler 配置写入器。
 *
 * 关键点（中文）
 * - `federation.json` 是简单的 City 项目声明，Wrangler 配置是部署时临时生成物。
 * - Cloudflare 默认值由 CLI 管理，用户不需要在 `federation.json` 里写 worker_name 等细节。
 * - D1 database id 由 CLI 在部署时解析，不污染用户手写配置。
 */

import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { FederationProjectConfigFile } from "@/federation/types/FederationProjectConfig.js";
import type { FederationAdminProvisioning } from "@downcity/city";

/** 写入 wrangler.toml 的结果。 */
export interface WranglerConfigWriteResult {
  /** wrangler.toml 绝对路径。 */
  config_path: string;
}

/**
 * 根据 City 项目配置和本地部署环境写入临时 wrangler.toml。
 */
export function writeWranglerConfig(
  config_file: FederationProjectConfigFile,
  database_id?: string,
  admin_provisioning?: FederationAdminProvisioning,
): WranglerConfigWriteResult {
  const config = config_file.config;
  const config_dir = mkdtempSync(join(tmpdir(), "downcity-wrangler-"));
  const config_path = join(config_dir, "wrangler.toml");
  const resolved_database_id = database_id ?? "";

  const lines = [
    `name = ${tomlString(config.name)}`,
    `main = ${tomlString(resolve(config_file.project_dir, config.entry))}`,
    `compatibility_date = ${tomlString("2025-05-12")}`,
    `compatibility_flags = ${tomlArray(["nodejs_compat"])}`,
    "workers_dev = true",
  ];

  if (config.deployment.resources.d1) {
    lines.push(
      "",
      "[[d1_databases]]",
      `binding = ${tomlString(config.deployment.resources.d1.binding)}`,
      `database_name = ${tomlString(config.deployment.resources.d1.name)}`,
      `database_id = ${tomlString(resolved_database_id)}`,
    );
  }

  if (config.deployment.resources.queue) {
    lines.push(
      "",
      "[[queues.producers]]",
      `binding = ${tomlString(config.deployment.resources.queue.binding)}`,
      `queue = ${tomlString(config.deployment.resources.queue.name)}`,
      "",
      "[[queues.consumers]]",
      `queue = ${tomlString(config.deployment.resources.queue.name)}`,
    );
  }

  if (config.deployment.resources.storage) {
    lines.push(
      "",
      "[[r2_buckets]]",
      `binding = ${tomlString(config.deployment.resources.storage.binding)}`,
      `bucket_name = ${tomlString(config.deployment.resources.storage.name)}`,
    );
  }

  const runtime_vars: Record<string, string> = {};
  if (config.deployment.resources.storage?.public_url_prefix) {
    runtime_vars.DOWNCITY_STORAGE_PUBLIC_URL_PREFIX = config.deployment.resources.storage.public_url_prefix;
  }
  if (admin_provisioning) {
    runtime_vars.DOWNCITY_FEDERATION_ADMIN_PROVISION_MODE = admin_provisioning.mode;
    runtime_vars.DOWNCITY_FEDERATION_ADMIN_PROVISION_ID = admin_provisioning.provision_id;
    runtime_vars.DOWNCITY_FEDERATION_ADMIN_ID = admin_provisioning.admin_id;
    runtime_vars.DOWNCITY_FEDERATION_ADMIN_PASSWORD_HASH = admin_provisioning.password_hash;
  }
  if (Object.keys(runtime_vars).length > 0) {
    lines.push(
      "",
      "[vars]",
      ...Object.entries(runtime_vars).map(([key, value]) => `${key} = ${tomlString(value)}`),
    );
  }

  lines.push(
    "",
    "[observability]",
    "enabled = true",
  );

  writeFileSync(config_path, `${lines.join("\n")}\n`);
  return { config_path };
}

/**
 * 渲染 TOML 字符串。
 */
function tomlString(value: string): string {
  return JSON.stringify(value);
}

/**
 * 渲染 TOML 字符串数组。
 */
function tomlArray(values: string[]): string {
  return `[${values.map(tomlString).join(", ")}]`;
}
