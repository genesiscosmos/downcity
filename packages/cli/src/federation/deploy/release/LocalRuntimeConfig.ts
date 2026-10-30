/**
 * 独立 Local Node 发布的持久运行配置。
 *
 * 仅 prepare 在部署时读取源码 .env；restart 通过 read 读取持久快照。
 * SQLite 只解析现有文件的位置，不复制或迁移数据。配置和数据目录仅限当前用户访问，
 * 配置通过同目录临时文件原子替换，错误信息不包含环境变量值或 JSON 原文。
 */
import { randomUUID } from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parse_dotenv } from "dotenv";
import { CliError } from "@/shared/CliError.js";

/** CLI 在启动时提供的字段与当前进程的环境字段，不进入持久配置。 */
const RUNTIME_ENV_KEYS = new Set([
  "HOST", "PORT", "PATH", "PATHEXT", "HOME", "USERPROFILE", "PWD", "OLDPWD",
  "SHELL", "SHLVL", "USER", "LOGNAME", "TMP", "TEMP", "TMPDIR", "_",
  "DOWNCITY_FED_ID", "DOWNCITY_RELEASE_ID", "DOWNCITY_FED_INSTANCE_ID",
  "DOWNCITY_FEDERATION_BASE_URL", "DOWNCITY_DATA_DIR",
]);

/** 部署时合并旧配置和源码 .env，生成不依赖源码目录的运行快照。 */
export function prepare_local_runtime_config(
  project_dir: string,
  config_dir: string,
  data_dir: string,
): {
  /** 持久化业务配置；CLI 的监听地址、身份和进程环境由启动者另外注入。 */
  runtime_env: Record<string, string>;
  /** SQLite 文件的绝对路径，可直接传给管理员数据库部署器。 */
  database_path: string;
  /** 权限为 0600 的 runtime.env.json 绝对路径。 */
  config_path: string;
} {
  const config_path = resolve(config_dir, "runtime.env.json");
  const absolute_data_dir = resolve(data_dir);
  try {
    for (const directory of [resolve(config_dir), absolute_data_dir]) {
      mkdirSync(directory, { recursive: true, mode: 0o700 });
      chmodSync(directory, 0o700);
    }
    const previous_env = existsSync(config_path) ? read_local_runtime_config(config_path) : {};
    const source_env_path = resolve(project_dir, ".env");
    const source_env = existsSync(source_env_path)
      ? parse_dotenv(readFileSync(source_env_path))
      : {};
    const previous_database = existing_database_path(previous_env, project_dir);
    if (existsSync(config_path) && !previous_database) {
      throw new CliError({ title: "The deployed SQLite database is missing",
        note: "Restore the registered database before deploying; refusing to create an empty replacement." });
    }
    const source_database = existing_database_path(source_env, project_dir);
    if (!source_database && !previous_database) {
      const legacy_paths = [join(project_dir, "data.sqlite"), join(project_dir, "data", "local.db")];
      if (legacy_paths.some((filename) => existsSync(filename))) {
        throw new CliError({ title: "An existing project database requires an explicit path",
          fix: "Set DOWNCITY_FEDERATION_DATABASE_URL in the project .env before deployment." });
      }
    }
    const database_path = source_database ?? previous_database ?? join(absolute_data_dir, "data.sqlite");
    const runtime_env = {
      ...persistent_env({ ...previous_env, ...source_env }),
      DATABASE_PATH: database_path,
      DOWNCITY_FEDERATION_DATABASE_URL: `file:${database_path}`,
      DOWNCITY_DATA_DIR: absolute_data_dir,
    };
    write_runtime_config(config_path, runtime_env);
    return { runtime_env, database_path, config_path };
  } catch (error) {
    if (error instanceof CliError) throw error;
    throw new CliError({ title: "Unable to prepare Local runtime configuration" });
  }
}

/** 仅读取运行快照并校验 string map；绝不读取源码 .env 或当前进程环境。 */
export function read_local_runtime_config(config_path: string): Record<string, string> {
  try {
    chmodSync(config_path, 0o600);
    const value: unknown = JSON.parse(readFileSync(config_path, "utf8"));
    if (!value || typeof value !== "object" || Array.isArray(value)
      || Object.values(value).some((entry) => typeof entry !== "string")) {
      throw new Error("Invalid runtime configuration");
    }
    // DOWNCITY_DATA_DIR 是 prepare 生成的稳定数据目录，restart 需要保留它。
    const entries = value as Record<string, string>;
    return {
      ...persistent_env(entries),
      ...(entries.DOWNCITY_DATA_DIR ? { DOWNCITY_DATA_DIR: entries.DOWNCITY_DATA_DIR } : {}),
    };
  } catch {
    throw new CliError({
      title: "Unable to read Local runtime configuration",
      note: "Expected a readable runtime.env.json containing an object of string values.",
    });
  }
}

/** 过滤启动参数与 dotenv 的加载控制参数，避免业务配置接管 CLI 启动过程。 */
function persistent_env(entries: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(entries).filter(([key]) => {
    const normalized_key = key.toUpperCase();
    return !RUNTIME_ENV_KEYS.has(normalized_key)
      && (!normalized_key.startsWith("NODE_") || normalized_key === "NODE_ENV")
      && !normalized_key.startsWith("DOWNCITY_FED_")
      && !normalized_key.startsWith("DOWNCITY_RELEASE_")
      && !normalized_key.startsWith("DOTENV_CONFIG_");
  }));
}

/** 显式路径仅在文件存在时沿用；源码相对路径以项目目录为基准。 */
function existing_database_path(entries: Record<string, string>, project_dir: string): string | undefined {
  const database_url = entries.DOWNCITY_FEDERATION_DATABASE_URL?.trim();
  const configured_path = database_url || entries.DATABASE_PATH?.trim();
  if (!configured_path) return undefined;
  if (database_url && !database_url.startsWith("file:")) {
    throw new CliError({
      title: "Local runtime requires SQLite",
      note: "DOWNCITY_FEDERATION_DATABASE_URL must use a file: SQLite URL.",
    });
  }
  const filename = configured_path.startsWith("file://")
    ? fileURLToPath(configured_path)
    : configured_path.replace(/^file:/u, "").trim();
  if (!filename) throw new CliError({ title: "Local SQLite database path is empty" });
  const database_path = resolve(project_dir, filename);
  return existsSync(database_path) && statSync(database_path).isFile() ? database_path : undefined;
}

/** 在同目录创建 0600 临时文件，通过 rename 原子替换快照并清理失败残留。 */
function write_runtime_config(config_path: string, runtime_env: Record<string, string>): void {
  const temporary_path = `${config_path}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temporary_path, `${JSON.stringify(runtime_env, null, 2)}\n`, {
      mode: 0o600,
      flag: "wx",
    });
    renameSync(temporary_path, config_path);
  } finally {
    rmSync(temporary_path, { force: true });
  }
}
