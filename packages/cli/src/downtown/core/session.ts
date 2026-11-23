/**
 * Downtown 管理端配置持久化模块。
 *
 * 关键说明（中文）
 * - downtown 的 server profile、管理员会话、Cloudflare account 与语言写入 `downcity.db`。
 * - 配置通过共享 LocalSettingRepository 保存，避免配置读写散落在业务模块。
 * - user session 由 `city` 维护，本模块只负责 Downtown admin 管理态。
 * - registry 不保存当前操作目标，每次操作由调用方显式指定或交互选择。
 */

import { with_cli_local_data } from "@/city/runtime/LocalData.js";
import { normalizeBaseUrl } from "@/downtown/core/env.js";
import type { CliLocale } from "@/shared/types/CliLocale.js";
import type {
  DowntownClientConfig,
  DowntownServerStatus,
  ServerProfile,
} from "@/downtown/types/DowntownRegistry.js";
import type {
  DowntownDeploymentTarget,
  DowntownProjectConfig,
} from "@/downtown/types/DowntownProjectConfig.js";

export type { ServerProfile } from "@/downtown/types/DowntownRegistry.js";

const DOWNTOWN_CONFIG_KEY = "downtown.config";

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

export type ClientConfig = DowntownClientConfig;

/** Server 写入输入复用完整 profile 字段，仅允许省略名称以便从 URL 推导。 */
type ServerProfileInput = Omit<ServerProfile, "name"> & {
  /** 用户可见名称；省略或仅含空白时从规范化后的 URL 推导。 */
  name?: string;
};

// ============================================================
// Config 读写
// ============================================================

/**
 * 从磁盘读取 config。
 */
export function readConfig(): ClientConfig {
  const raw = readStoredConfig() ?? {};
  const servers = readServersFromConfig(raw);

  const config = {
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
  const normalized_servers = normalizeServers(config.servers);

  writeStoredConfig({
    servers: normalized_servers,
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
 * 添加 server 连接记录并返回该对象，不保存操作目标。
 */
export function addServer(input: ServerProfileInput): ServerProfile {
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
  });

  return normalized;
}

/**
 * 更新已存在的 server 连接记录，不保存操作目标。
 */
export function updateServer(
  currentBaseUrl: string,
  input: ServerProfileInput,
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
  writeConfig({
    ...config,
    servers: config.servers,
  });

  return normalizedNext;
}

/**
 * 删除 server 连接记录；不停止实例进程，也不修改 City 连接配置。
 */
export function removeServer(base_url: string): void {
  const config = readConfig();
  const normalized_base_url = normalizeBaseUrl(base_url);
  const next_servers = config.servers.filter((server) => server.base_url !== normalized_base_url);

  writeConfig({
    ...config,
    servers: next_servers,
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
  target?: DowntownDeploymentTarget,
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
 * - deploy 只更新实例元数据与非敏感管理员 ID，不保存操作目标。
 * - 同一 Fed 的部署 URL 变化时会替换旧记录。
 * - 发布与运行路径仅取本次输入，未提供时清空，避免失败的新部署继承旧发布信息。
 */
export function register_deployed_server(input: {
  /** 部署项目配置。 */
  config: DowntownProjectConfig;
  /** 部署来源的源码目录，仅用于源码追溯，不作为实例运行目录。 */
  project_dir: string;
  /** 本次部署的发布版本标识；未生成时省略，不继承上一实例的发布版本。 */
  release_id?: string;
  /** 本次部署的发布产物目录，用于加载运行时代码；省略时不继承旧目录。 */
  release_dir?: string;
  /** 本次部署实际加载的运行时配置文件路径；省略时不继承旧配置路径。 */
  runtime_config_path?: string;
  /** 本次部署使用的持久化数据目录，独立于发布产物；省略时不继承旧目录。 */
  data_dir?: string;
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
  status: DowntownServerStatus;
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
    release_id: input.release_id,
    release_dir: input.release_dir,
    runtime_config_path: input.runtime_config_path,
    data_dir: input.data_dir,
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

function normalizeServer(input: ServerProfileInput): ServerProfile {
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
    release_id: normalize_optional_text(input.release_id),
    release_dir: normalize_optional_text(input.release_dir),
    runtime_config_path: normalize_optional_text(input.runtime_config_path),
    data_dir: normalize_optional_text(input.data_dir),
    pid: normalize_positive_integer(input.pid),
    instance_id: normalize_optional_text(input.instance_id),
    port: normalize_positive_integer(input.port),
    log_path: normalize_optional_text(input.log_path),
    deployed_at: normalize_optional_text(input.deployed_at),
    status: normalize_status(input.status),
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
    release_id: normalize_optional_text(record.release_id),
    release_dir: normalize_optional_text(record.release_dir),
    runtime_config_path: normalize_optional_text(record.runtime_config_path),
    data_dir: normalize_optional_text(record.data_dir),
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
function normalize_target(value: unknown): DowntownDeploymentTarget | undefined {
  return value === "local" || value === "cloudflare-workers" ? value : undefined;
}

/** 规范化实例状态。 */
function normalize_status(value: unknown): DowntownServerStatus | undefined {
  return value === "starting" || value === "running" || value === "deployed"
    || value === "stopped" || value === "failed" || value === "unknown"
    ? value
    : undefined;
}

/** 判断 registry 快照是否仍像 Downtown 配置。 */
function is_project_config(value: unknown): value is DowntownProjectConfig {
  return Boolean(
    value
    && typeof value === "object"
    && (value as { type?: unknown }).type === "downtown"
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
  return with_cli_local_data((data) =>
    data.settings.get<Record<string, unknown>>(DOWNTOWN_CONFIG_KEY) ?? undefined
  );
}

function writeStoredConfig(config: ClientConfig): void {
  with_cli_local_data((data) => data.settings.set(DOWNTOWN_CONFIG_KEY, config));
}
