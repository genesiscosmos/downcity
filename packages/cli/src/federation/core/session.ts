/**
 * Federation 管理端配置持久化模块。
 *
 * 关键说明（中文）
 * - downfed 的 server profile、管理员会话、Cloudflare account 与语言写入 `federation.db`。
 * - 配置整体通过 PlatformStore secure setting 加密保存，避免明文 JSON 状态散落。
 * - user session 由 `city` 维护，本模块只负责 Federation admin 管理态。
 */

import { create_federation_platform_store } from "@/city/runtime/store/index.js";
import { normalizeBaseUrl } from "@/federation/core/env.js";
import type { CliLocale } from "@/shared/types/CliLocale.js";
import type {
  FederationClientConfig,
  FederationServerStatus,
  ServerProfile,
} from "@/federation/types/FederationRegistry.js";
import type {
  FederationDeploymentTarget,
  FederationProjectConfig,
} from "@/federation/types/FederationProjectConfig.js";

export type { ServerProfile } from "@/federation/types/FederationRegistry.js";

const FEDERATION_CONFIG_KEY = "federation.config";

// ============================================================
// 类型
// ============================================================

export interface AdminSession {
  /** 当前 server 的 server URL */
  base_url: string;
  /** 当前 server 的管理员 Session Token。 */
  session_token: string;
  /** 当前管理员 ID。 */
  admin_id: string;
  /** 当前管理员 Session 到期时间。 */
  expires_at: string;
}

export type ClientConfig = FederationClientConfig;

// ============================================================
// Config 读写
// ============================================================

/**
 * 从磁盘读取 config。
 */
export function readConfig(): ClientConfig {
  const raw = readStoredConfig() ?? {};
  const servers = readServersFromConfig(raw);
  const active_server_url = readActiveServerURL(raw, servers);

  const config = {
    active_server_url,
    servers,
    cloudflare_account_id: typeof raw.cloudflare_account_id === "string"
      ? raw.cloudflare_account_id.trim() || undefined
      : undefined,
    model: typeof raw.model === "string" ? raw.model : "",
    cli_locale: normalizeCliLocale(raw.cli_locale),
  };

  return config;
}

/**
 * 写入 config 到磁盘。
 */
export function writeConfig(config: ClientConfig): void {
  const normalizedServers = normalizeServers(config.servers);
  const active = normalizedServers.find((server) => server.base_url === config.active_server_url)
    ? config.active_server_url
    : undefined;

  writeStoredConfig({
    active_server_url: active,
    servers: normalizedServers,
    cloudflare_account_id: typeof config.cloudflare_account_id === "string"
      ? config.cloudflare_account_id.trim() || undefined
      : undefined,
    model: config.model ?? "",
    cli_locale: normalizeCliLocale(config.cli_locale),
  });
}

/**
 * 读取持久化的 CLI 语言。
 */
export function readPersistedCliLocale(): CliLocale | undefined {
  return readConfig().cli_locale;
}

/**
 * 写入持久化的 CLI 语言。
 */
export function writePersistedCliLocale(cli_locale: CliLocale): void {
  const config = readConfig();
  writeConfig({
    ...config,
    cli_locale,
  });
}

/**
 * 读取当前保存的 Cloudflare account id。
 */
export function readCloudflareAccountId(): string | undefined {
  return readConfig().cloudflare_account_id;
}

/**
 * 写入当前 Cloudflare account id。
 */
export function writeCloudflareAccountId(account_id: string): void {
  const config = readConfig();
  writeConfig({
    ...config,
    cloudflare_account_id: String(account_id).trim() || undefined,
  });
}

// ============================================================
// Server 管理
// ============================================================

/**
 * 读取当前激活的 server。
 */
export function readActiveServer(): ServerProfile | undefined {
  const config = readConfig();
  return config.servers.find((server) => server.base_url === config.active_server_url);
}

/**
 * 设置当前激活的 server。
 */
export function setActiveServer(baseUrl: string): void {
  const config = readConfig();
  const normalizedBaseUrl = normalizeBaseUrl(baseUrl);
  if (!config.servers.find((server) => server.base_url === normalizedBaseUrl)) {
    throw new Error(`Unknown server: ${normalizedBaseUrl}`);
  }
  writeConfig({
    ...config,
    active_server_url: normalizedBaseUrl,
  });
}

/**
 * 添加 server，并设为当前激活 server。
 */
export function addServer(input: {
  base_url: string;
  admin_id?: string;
  admin_session_token?: string;
  admin_session_expires_at?: string;
  name?: string;
  fed_id?: string;
  target?: FederationDeploymentTarget;
  project_dir?: string;
  pid?: number;
  instance_id?: string;
  port?: number;
  log_path?: string;
  deployed_at?: string;
  status?: FederationServerStatus;
  config_snapshot?: FederationProjectConfig;
}): ServerProfile {
  const config = readConfig();
  const normalized = normalizeServer(input);
  const existingIndex = config.servers.findIndex((server) => server.base_url === normalized.base_url);

  if (existingIndex >= 0) {
    config.servers[existingIndex] = normalized;
  } else {
    config.servers.push(normalized);
  }

  writeConfig({
    ...config,
    servers: config.servers,
    active_server_url: normalized.base_url,
  });

  return normalized;
}

/**
 * 更新已存在的 server。
 *
 * 关键说明（中文）
 * - active server 会自动切换到新 URL
 */
export function updateServer(
  currentBaseUrl: string,
  input: {
    base_url: string;
    admin_id?: string;
    admin_session_token?: string;
    admin_session_expires_at?: string;
    name?: string;
    fed_id?: string;
    target?: FederationDeploymentTarget;
    project_dir?: string;
    pid?: number;
    instance_id?: string;
    port?: number;
    log_path?: string;
    deployed_at?: string;
    status?: FederationServerStatus;
    config_snapshot?: FederationProjectConfig;
  },
): ServerProfile {
  const config = readConfig();
  const normalizedCurrent = normalizeBaseUrl(currentBaseUrl);
  const index = config.servers.findIndex((server) => server.base_url === normalizedCurrent);
  if (index < 0) {
    throw new Error(`Unknown server: ${normalizedCurrent}`);
  }

  const normalizedNext = normalizeServer(input);
  const duplicateIndex = config.servers.findIndex((server) => server.base_url === normalizedNext.base_url);
  if (duplicateIndex >= 0 && duplicateIndex !== index) {
    throw new Error(`Server already exists: ${normalizedNext.base_url}`);
  }

  config.servers[index] = normalizedNext;
  const activeServerUrl = config.active_server_url === normalizedCurrent
    ? normalizedNext.base_url
    : config.active_server_url;

  writeConfig({
    ...config,
    servers: config.servers,
    active_server_url: activeServerUrl,
  });

  return normalizedNext;
}

/**
 * 删除 server。
 *
 * 关键说明（中文）
 * - 删除当前 active server 后只清空选择，不隐式切换到其他 server。
 */
export function removeServer(baseUrl: string): void {
  const config = readConfig();
  const normalizedBaseUrl = normalizeBaseUrl(baseUrl);
  const nextServers = config.servers.filter((server) => server.base_url !== normalizedBaseUrl);
  const nextActive = config.active_server_url === normalizedBaseUrl
    ? undefined
    : config.active_server_url;

  writeConfig({
    ...config,
    servers: nextServers,
    active_server_url: nextActive,
  });
}

/**
 * 根据 URL 读取 server。
 */
export function readServer(baseUrl: string): ServerProfile | undefined {
  const normalizedBaseUrl = normalizeBaseUrl(baseUrl);
  return readConfig().servers.find((server) => server.base_url === normalizedBaseUrl);
}

/** 根据 Fed ID 和部署目标读取已登记实例。 */
export function read_server_by_fed_id(
  fed_id: string,
  target?: FederationDeploymentTarget,
): ServerProfile | undefined {
  const normalized_id = String(fed_id).trim();
  return readConfig().servers.find((server) => (
    server.fed_id === normalized_id
    && (target === undefined || server.target === target)
  ));
}

/**
 * 登记一次由 `fed deploy` 创建的实例。
 *
 * 关键说明（中文）
 * - deploy 只更新实例元数据与非敏感管理员 ID，不修改用户显式选择的 active server。
 * - 同一 Fed 的部署 URL 变化时会替换旧记录；若旧记录原本为 active，写入时会清空失效选择。
 */
export function register_deployed_server(input: {
  /** 部署项目配置。 */
  config: FederationProjectConfig;
  /** 部署项目目录。 */
  project_dir: string;
  /** 部署完成后的 HTTP URL。 */
  base_url: string;
  /** 本地进程 PID。 */
  pid?: number;
  /** 本地进程 instance ID。 */
  instance_id?: string;
  /** 本地实际端口。 */
  port?: number;
  /** 本地日志路径。 */
  log_path?: string;
  /** 部署结果状态。 */
  status: FederationServerStatus;
  /** 部署创建或恢复后确认有效的管理员 ID。 */
  admin_id?: string;
}): ServerProfile {
  const config = readConfig();
  const normalized_base_url = normalizeBaseUrl(input.base_url);
  const existing = config.servers.find((server) => (
    server.fed_id === input.config.id
    && server.target === input.config.deployment.target
  ));
  const existing_by_url = config.servers.find((server) => server.base_url === normalized_base_url);
  const previous_profile = existing ?? existing_by_url;
  const next_admin_id = input.admin_id ?? previous_profile?.admin_id;
  const preserve_admin_session = Boolean(
    next_admin_id
    && previous_profile?.admin_id === next_admin_id,
  );
  const normalized = normalizeServer({
    name: input.config.name,
    base_url: normalized_base_url,
    admin_id: next_admin_id,
    admin_session_token: preserve_admin_session ? previous_profile?.admin_session_token : undefined,
    admin_session_expires_at: preserve_admin_session
      ? previous_profile?.admin_session_expires_at
      : undefined,
    fed_id: input.config.id,
    target: input.config.deployment.target,
    project_dir: input.project_dir,
    pid: input.pid,
    instance_id: input.instance_id,
    port: input.port,
    log_path: input.log_path,
    deployed_at: new Date().toISOString(),
    status: input.status,
    config_snapshot: input.config,
  });
  const next_servers = config.servers.filter((server) => (
    server.base_url !== normalized.base_url
    && !(
      server.fed_id === input.config.id
      && server.target === input.config.deployment.target
    )
  ));
  next_servers.push(normalized);
  writeConfig({
    ...config,
    servers: next_servers,
  });
  return normalized;
}

// ============================================================
// 内部工具
// ============================================================

function readServersFromConfig(raw: Record<string, unknown>): ServerProfile[] {
  const input = Array.isArray(raw.servers) ? raw.servers : [];
  const servers: ServerProfile[] = [];

  for (const item of input) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    const rawBaseUrl = typeof record.base_url === "string" ? record.base_url : "";

    if (!rawBaseUrl.trim()) continue;

    const normalizedBaseUrl = normalizeBaseUrl(rawBaseUrl);
    const admin_id = normalize_optional_text(record.admin_id);
    const admin_session_token = normalize_optional_text(record.admin_session_token);
    const admin_session_expires_at = normalize_optional_text(record.admin_session_expires_at);
    const name = typeof record.name === "string" && record.name.trim()
      ? record.name.trim()
      : deriveServerName(normalizedBaseUrl);

    const existing = servers.find((server) => server.base_url === normalizedBaseUrl);
    const metadata = read_server_metadata(record);
    if (existing) {
      existing.name = name;
      existing.admin_id = admin_id;
      existing.admin_session_token = admin_session_token;
      existing.admin_session_expires_at = admin_session_expires_at;
      Object.assign(existing, metadata);
      continue;
    }

    servers.push({
      name,
      base_url: normalizedBaseUrl,
      admin_id,
      admin_session_token,
      admin_session_expires_at,
      ...metadata,
    });
  }

  return servers;
}

function normalizeCliLocale(value: unknown): CliLocale | undefined {
  const raw = String(value ?? "").trim().toLowerCase();
  if (raw === "zh") return "zh";
  if (raw === "en") return "en";
  return undefined;
}

function readActiveServerURL(raw: Record<string, unknown>, servers: ServerProfile[]): string | undefined {
  const rawActive = typeof raw.active_server_url === "string"
    ? raw.active_server_url
    : "";

  if (rawActive.trim()) {
    const normalized = normalizeBaseUrl(rawActive);
    if (servers.find((server) => server.base_url === normalized)) {
      return normalized;
    }
  }

  return undefined;
}

function normalizeServers(servers: ServerProfile[]): ServerProfile[] {
  const normalized: ServerProfile[] = [];

  for (const server of servers) {
    const item = normalizeServer(server);
    if (normalized.find((candidate) => candidate.base_url === item.base_url)) {
      continue;
    }
    normalized.push(item);
  }

  return normalized;
}

function normalizeServer(input: {
  base_url: string;
  admin_id?: string;
  admin_session_token?: string;
  admin_session_expires_at?: string;
  name?: string;
  fed_id?: string;
  target?: FederationDeploymentTarget;
  project_dir?: string;
  pid?: number;
  instance_id?: string;
  port?: number;
  log_path?: string;
  deployed_at?: string;
  status?: FederationServerStatus;
  config_snapshot?: FederationProjectConfig;
}): ServerProfile {
  const normalizedBaseUrl = normalizeBaseUrl(input.base_url);
  const normalizedName = String(input.name ?? "").trim() || deriveServerName(normalizedBaseUrl);

  return {
    name: normalizedName,
    base_url: normalizedBaseUrl,
    admin_id: normalize_optional_text(input.admin_id),
    admin_session_token: normalize_optional_text(input.admin_session_token),
    admin_session_expires_at: normalize_optional_text(input.admin_session_expires_at),
    fed_id: normalize_optional_text(input.fed_id),
    target: normalize_target(input.target),
    project_dir: normalize_optional_text(input.project_dir),
    pid: normalize_positive_integer(input.pid),
    instance_id: normalize_optional_text(input.instance_id),
    port: normalize_positive_integer(input.port),
    log_path: normalize_optional_text(input.log_path),
    deployed_at: normalize_optional_text(input.deployed_at),
    status: resolve_server_status(input.status, input.target, input.pid),
    config_snapshot: input.config_snapshot,
  };
}

/** 读取并刷新旧状态记录中的扩展字段。 */
function read_server_metadata(record: Record<string, unknown>): Partial<ServerProfile> {
  return {
    admin_id: normalize_optional_text(record.admin_id),
    admin_session_token: normalize_optional_text(record.admin_session_token),
    admin_session_expires_at: normalize_optional_text(record.admin_session_expires_at),
    fed_id: typeof record.fed_id === "string" ? record.fed_id : undefined,
    target: normalize_target(record.target),
    project_dir: typeof record.project_dir === "string" ? record.project_dir : undefined,
    pid: normalize_positive_integer(record.pid),
    instance_id: typeof record.instance_id === "string" ? record.instance_id : undefined,
    port: normalize_positive_integer(record.port),
    log_path: typeof record.log_path === "string" ? record.log_path : undefined,
    deployed_at: typeof record.deployed_at === "string" ? record.deployed_at : undefined,
    status: normalize_status(record.status),
    config_snapshot: is_project_config(record.config_snapshot) ? record.config_snapshot : undefined,
  };
}

/** 规范化可选文本。 */
function normalize_optional_text(value: unknown): string | undefined {
  return typeof value === "string" ? value.trim() || undefined : undefined;
}

/** 规范化正整数。 */
function normalize_positive_integer(value: unknown): number | undefined {
  const number = typeof value === "number" ? value : Number.NaN;
  return Number.isInteger(number) && number > 0 ? number : undefined;
}

/** 规范化部署目标。 */
function normalize_target(value: unknown): FederationDeploymentTarget | undefined {
  return value === "local" || value === "cloudflare-workers" ? value : undefined;
}

/** 规范化实例状态。 */
function normalize_status(value: unknown): FederationServerStatus | undefined {
  return value === "starting" || value === "running" || value === "deployed"
    || value === "stopped" || value === "failed" || value === "unknown"
    ? value
    : undefined;
}

/** 本地记录根据 PID 实时推导状态，避免 TUI 长期展示失效进程。 */
function resolve_server_status(
  status: FederationServerStatus | undefined,
  target: FederationDeploymentTarget | undefined,
  pid: number | undefined,
): FederationServerStatus | undefined {
  if (target !== "local" || !pid) return status;
  try {
    process.kill(pid, 0);
    return "running";
  } catch {
    return "stopped";
  }
}

/** 判断 registry 快照是否仍像 Federation 配置。 */
function is_project_config(value: unknown): value is FederationProjectConfig {
  return Boolean(
    value
    && typeof value === "object"
    && (value as { type?: unknown }).type === "federation"
    && typeof (value as { id?: unknown }).id === "string",
  );
}

function deriveServerName(baseUrl: string): string {
  try {
    const url = new URL(baseUrl);
    return url.hostname || baseUrl;
  } catch {
    return baseUrl;
  }
}

function readStoredConfig(): Record<string, unknown> | undefined {
  const store = create_federation_platform_store();
  try {
    return store.getSecureSettingJsonSync<Record<string, unknown>>(FEDERATION_CONFIG_KEY) ?? undefined;
  } finally {
    store.close();
  }
}

function writeStoredConfig(config: ClientConfig): void {
  const store = create_federation_platform_store();
  try {
    store.setSecureSettingJsonSync(FEDERATION_CONFIG_KEY, config);
  } finally {
    store.close();
  }
}
