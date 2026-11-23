/**
 * Downtown 项目配置读取器。
 *
 * 关键说明（中文）
 * - 项目声明使用 TOML，Local 进程策略严格校验并补齐默认值。
 * - 目标默认值集中在这里，模板和部署器消费同一份规范化配置。
 * - 项目配置不保存运行状态；registry 保存登记记录，用户级系统 manager 管理本地服务。
 */

import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parse as parse_toml } from "smol-toml";
import { CliError } from "@/shared/CliError.js";
import type {
  DowntownDeploymentConfig,
  DowntownDeploymentScriptsConfig,
  DowntownDeploymentTarget,
  DowntownProcessConfig,
  DowntownProjectConfig,
  DowntownProjectConfigFile,
  DowntownProjectResourcesConfig,
} from "@/downtown/types/DowntownProjectConfig.js";

/** 项目声明的唯一文件名；JSON 配置不再作为读取入口。 */
export const DOWNTOWN_CONFIG_FILE_NAME = "downtown.toml";
/** 本地目标的固定默认端口；用户只能通过 deployment.port 显式覆盖。 */
export const DEFAULT_LOCAL_DOWNTOWN_PORT = 12314;

/** 读取并校验指定目录中的 `downtown.toml`。 */
export function read_downtown_project_config(dir: string): DowntownProjectConfigFile {
  const project_dir = resolve(String(dir || "."));
  const config_path = join(project_dir, DOWNTOWN_CONFIG_FILE_NAME);
  if (!existsSync(config_path)) {
    throw new CliError({
      title: "Downtown project config not found",
      note: `Expected ${config_path}`,
      fix: "Run `fed create` or add a valid downtown.toml to the project.",
    });
  }

  let raw_config: unknown;
  try {
    raw_config = parse_toml(readFileSync(config_path, "utf-8"));
  } catch (error) {
    throw new CliError({
      title: "Invalid downtown.toml",
      note: error instanceof Error ? error.message : String(error),
      fix: "Check that downtown.toml is valid TOML.",
    });
  }

  return {
    project_dir,
    config_path,
    config: normalize_downtown_project_config(raw_config, config_path),
  };
}

/** 将 TOML 解析结果严格规范化为 Downtown 配置。 */
function normalize_downtown_project_config(
  input: unknown,
  config_path: string,
): DowntownProjectConfig {
  if (!is_record(input)) throw invalid_config(config_path, "Root value must be an object.");

  const schema = read_number(input, "schema", 1);
  if (schema !== 1) throw invalid_config(config_path, `Unsupported schema: ${schema}`);

  const type = read_string(input, "type", "");
  if (type !== "downtown") {
    throw invalid_config(config_path, "type must be downtown.");
  }

  const id = read_string(input, "id", "");
  if (!/^fed_[a-zA-Z0-9_-]+$/u.test(id)) {
    throw invalid_config(config_path, "id must start with fed_ and contain only letters, numbers, _ or -.");
  }

  const name = read_string(input, "name", "");
  if (!name) throw invalid_config(config_path, "name is required.");

  const entry = read_string(input, "entry", "src/index.ts");
  const deployment_input = read_record(input, "deployment");
  if (!deployment_input) throw invalid_config(config_path, "deployment is required.");

  return {
    schema: 1,
    type: "downtown",
    id,
    name,
    entry,
    deployment: normalize_deployment(deployment_input, name, config_path),
  };
}

/** 校验部署目标并补齐各目标默认资源。 */
function normalize_deployment(
  input: Record<string, unknown>,
  project_name: string,
  config_path: string,
): DowntownDeploymentConfig {
  const target_input = read_string(input, "target", "");
  if (target_input !== "local" && target_input !== "cloudflare-workers") {
    throw invalid_config(config_path, `Unsupported deployment target: ${target_input || "(empty)"}`);
  }
  const target: DowntownDeploymentTarget = target_input;
  if (target !== "local" && input.process !== undefined) {
    throw invalid_config(config_path, "deployment.process requires local.");
  }
  const port = input.port === undefined
    ? (target === "local" ? DEFAULT_LOCAL_DOWNTOWN_PORT : undefined)
    : read_optional_number(input, "port");
  if ((input.port !== undefined && port === undefined)
    || (port !== undefined && (!Number.isInteger(port) || port < 1 || port > 65535))) {
    throw invalid_config(config_path, "deployment.port must be an integer between 1 and 65535.");
  }

  return {
    target,
    host: read_optional_string(input, "host"),
    port,
    url: read_optional_string(input, "url"),
    process: target === "local" ? normalize_process(input.process, config_path) : undefined,
    scripts: normalize_scripts(read_record(input, "scripts")),
    crons: normalize_crons(input.crons, target, config_path),
    resources: normalize_resources(read_record(input, "resources"), target, project_name),
  };
}

/** 严格校验 Local 用户级服务策略，并始终补齐两个布尔默认值。 */
function normalize_process(input: unknown, config_path: string): DowntownProcessConfig {
  if (input === undefined) return { auto_start: false, restart_on_failure: true };
  if (!is_record(input) || input instanceof Date) {
    throw invalid_config(config_path, "deployment.process must be an object.");
  }
  for (const key of Object.keys(input)) {
    if (key !== "auto_start" && key !== "restart_on_failure") {
      throw invalid_config(config_path, `Unknown deployment.process field: ${key}`);
    }
    if (typeof input[key] !== "boolean") {
      throw invalid_config(config_path, `deployment.process.${key} must be a boolean.`);
    }
  }
  return {
    auto_start: input.auto_start === true,
    restart_on_failure: input.restart_on_failure !== false,
  };
}

/** 校验最多三条 UTC 五字段数字 cron；空数组显式清空定时触发。 */
function normalize_crons(
  input: unknown,
  target: DowntownDeploymentTarget,
  config_path: string,
): string[] | undefined {
  if (input === undefined) return undefined;
  if (!Array.isArray(input) || input.length > 3) {
    throw invalid_config(config_path, "deployment.crons must be an array of at most 3 cron expressions.");
  }
  if (target !== "cloudflare-workers") {
    throw invalid_config(config_path, "deployment.crons requires cloudflare-workers.");
  }
  const limits = [[0, 59], [0, 23], [1, 31], [1, 12], [0, 6]] as const;
  return input.map((value: unknown) => {
    const fields = typeof value === "string" ? value.trim().split(/\s+/u) : [];
    if (fields.length !== 5 || !fields.every((field, index) => {
      const [minimum, maximum] = limits[index]!;
      return field.split(",").every((part) => valid_cron_part(part, minimum, maximum));
    })) {
      throw invalid_config(config_path, "deployment.crons requires valid five-field numeric cron expressions.");
    }
    return fields.join(" ");
  });
}

/** 校验单个通配符、数字或升序范围，以及可选的正整数步长。 */
function valid_cron_part(part: string, minimum: number, maximum: number): boolean {
  const match = /^(\*|\d+(?:-\d+)?)(?:\/(\d+))?$/u.exec(part);
  if (!match) return false;
  const step = match[2] === undefined ? 1 : Number(match[2]);
  if (!Number.isSafeInteger(step) || step < 1 || step > maximum - minimum + 1) return false;
  if (match[1] === "*") return true;
  const bounds = match[1]!.split("-").map(Number);
  const start = bounds[0]!;
  const end = bounds[1] ?? start;
  return Number.isSafeInteger(start) && Number.isSafeInteger(end)
    && start >= minimum && end <= maximum && start <= end;
}

/** 读取用户提供的阶段脚本。 */
function normalize_scripts(
  input: Record<string, unknown> | undefined,
): DowntownDeploymentScriptsConfig | undefined {
  if (!input) return undefined;
  const scripts = {
    build: read_optional_string(input, "build"),
    deploy: read_optional_string(input, "deploy"),
  };
  return scripts.build || scripts.deploy ? scripts : undefined;
}

/** 根据目标解析资源；Local 项目始终没有云资源。 */
function normalize_resources(
  input: Record<string, unknown> | undefined,
  target: DowntownDeploymentTarget,
  project_name: string,
): DowntownProjectResourcesConfig {
  if (target === "local") return {};

  const d1 = read_record(input ?? {}, "d1");
  const hyperdrive = read_record(input ?? {}, "hyperdrive");
  if (input?.hyperdrive !== undefined && !hyperdrive) {
    throw new CliError({ title: "deployment.resources.hyperdrive must be an object" });
  }
  if (d1 && hyperdrive) {
    throw new CliError({ title: "Declare only one database resource: d1 or hyperdrive" });
  }
  const id_env = read_optional_string(hyperdrive ?? {}, "id_env");
  if (hyperdrive && ((hyperdrive.id !== undefined) === (hyperdrive.id_env !== undefined)
    || (hyperdrive.id_env !== undefined && (!id_env || !/^[A-Za-z_][A-Za-z0-9_]*$/u.test(id_env))))) {
    throw new CliError({ title: "Hyperdrive requires exactly one of id or id_env; id_env must be an environment variable name" });
  }
  const hyperdrive_id = id_env ? process.env[id_env]?.trim() : read_optional_string(hyperdrive ?? {}, "id");
  const hyperdrive_binding = read_string(hyperdrive ?? {}, "binding", "HYPERDRIVE");
  const database_url_env = read_optional_string(hyperdrive ?? {}, "database_url_env");
  if (hyperdrive && (!hyperdrive_id || !/^[a-f0-9]{32}$/iu.test(hyperdrive_id)
    || !/^[A-Za-z_][A-Za-z0-9_]*$/u.test(hyperdrive_binding)
    || (database_url_env !== undefined && !/^[A-Za-z_][A-Za-z0-9_]*$/u.test(database_url_env)))) {
    throw new CliError({ title: "Hyperdrive requires a 32-character hexadecimal id and valid binding/environment variable names" });
  }
  const queue = read_record(input ?? {}, "queue");
  if (input?.queue !== undefined && !queue) {
    throw new CliError({ title: "deployment.resources.queue must be an object" });
  }
  const dead_letter_queue = read_optional_string(queue ?? {}, "dead_letter_queue");
  if (queue?.dead_letter_queue !== undefined && !dead_letter_queue) {
    throw new CliError({ title: "deployment.resources.queue.dead_letter_queue must be a non-empty string" });
  }
  const max_retries = read_optional_number(queue ?? {}, "max_retries");
  if (queue?.max_retries !== undefined
    && (max_retries === undefined || !Number.isInteger(max_retries) || max_retries < 0 || max_retries > 100)) {
    throw new CliError({ title: "deployment.resources.queue.max_retries must be an integer between 0 and 100" });
  }
  const storage = read_record(input ?? {}, "storage");
  return {
    ...(d1 ? {
      d1: {
        type: "d1" as const,
        binding: read_string(d1, "binding", "DB"),
        name: read_string(d1, "name", `${project_name}-db`),
      },
    } : {}),
    ...(hyperdrive ? {
      hyperdrive: {
        type: "hyperdrive" as const,
        binding: hyperdrive_binding,
        id: hyperdrive_id!,
        ...(id_env ? { id_env } : {}),
        ...(database_url_env ? { database_url_env } : {}),
      },
    } : {}),
    queue: {
      type: "queue",
      binding: read_string(queue ?? {}, "binding", "DOWNCITY_QUEUE"),
      name: read_string(queue ?? {}, "name", `${project_name}-queue`),
      ...(dead_letter_queue !== undefined ? { dead_letter_queue } : {}),
      ...(max_retries !== undefined ? { max_retries } : {}),
    },
    ...(storage
      ? {
          storage: {
            type: "r2" as const,
            binding: read_string(storage, "binding", "DOWNCITY_STORAGE"),
            name: read_string(storage, "name", `${project_name}-storage`),
            public_url_prefix: read_string(storage, "public_url_prefix", ""),
          },
        }
      : {}),
  };
}

/** 创建带统一修复提示的配置错误。 */
function invalid_config(config_path: string, note: string): CliError {
  return new CliError({
    title: "Invalid downtown.toml",
    note: `${config_path}: ${note}`,
    fix: "Run `fed create` to generate the current Downtown project format.",
  });
}

/** 判断未知值是否为普通对象。 */
function is_record(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

/** 读取可选对象字段。 */
function read_record(input: Record<string, unknown>, key: string): Record<string, unknown> | undefined {
  const value = input[key];
  return is_record(value) ? value : undefined;
}

/** 读取字符串字段并应用默认值。 */
function read_string(input: Record<string, unknown>, key: string, fallback: string): string {
  return read_optional_string(input, key) ?? fallback;
}

/** 读取可选字符串字段。 */
function read_optional_string(input: Record<string, unknown>, key: string): string | undefined {
  const value = input[key];
  if (typeof value !== "string") return undefined;
  return value.trim() || undefined;
}

/** 读取整数型字段并应用默认值。 */
function read_number(input: Record<string, unknown>, key: string, fallback: number): number {
  return read_optional_number(input, key) ?? fallback;
}

/** 读取可选数字字段。 */
function read_optional_number(input: Record<string, unknown>, key: string): number | undefined {
  const value = input[key];
  return typeof value === "number" ? value : undefined;
}
