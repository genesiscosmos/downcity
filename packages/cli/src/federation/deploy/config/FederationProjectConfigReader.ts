/**
 * Federation 项目配置读取器。
 *
 * 关键说明（中文）
 * - 配置采用严格的新结构，不读取旧的 City / runtime 字段。
 * - 目标默认值集中在这里，模板和部署器消费同一份规范化配置。
 * - 运行状态不写回项目配置，统一进入系统级 Federation registry。
 */

import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { CliError } from "@/shared/CliError.js";
import type {
  FederationDeploymentConfig,
  FederationDeploymentScriptsConfig,
  FederationDeploymentTarget,
  FederationProjectConfig,
  FederationProjectConfigFile,
  FederationProjectResourcesConfig,
} from "@/federation/types/FederationProjectConfig.js";

const FEDERATION_CONFIG_FILE_NAME = "federation.json";

/** 读取并校验指定目录中的 `federation.json`。 */
export function read_federation_project_config(dir: string): FederationProjectConfigFile {
  const project_dir = resolve(String(dir || "."));
  const config_path = join(project_dir, FEDERATION_CONFIG_FILE_NAME);
  if (!existsSync(config_path)) {
    throw new CliError({
      title: "Federation project config not found",
      note: `Expected ${config_path}`,
      fix: "Run `fed create` or add a valid federation.json to the project.",
    });
  }

  let raw_config: unknown;
  try {
    raw_config = JSON.parse(readFileSync(config_path, "utf-8"));
  } catch (error) {
    throw new CliError({
      title: "Invalid federation.json",
      note: error instanceof Error ? error.message : String(error),
      fix: "Check that federation.json is valid JSON.",
    });
  }

  return {
    project_dir,
    config_path,
    config: normalize_federation_project_config(raw_config, config_path),
  };
}

/** 将未知 JSON 严格规范化为 Federation 配置。 */
function normalize_federation_project_config(
  input: unknown,
  config_path: string,
): FederationProjectConfig {
  if (!is_record(input)) throw invalid_config(config_path, "Root value must be an object.");

  const schema = read_number(input, "schema", 1);
  if (schema !== 1) throw invalid_config(config_path, `Unsupported schema: ${schema}`);

  const type = read_string(input, "type", "");
  if (type !== "federation") {
    throw invalid_config(config_path, "type must be federation.");
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
    type: "federation",
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
): FederationDeploymentConfig {
  const target_input = read_string(input, "target", "");
  if (target_input !== "local" && target_input !== "cloudflare-workers") {
    throw invalid_config(config_path, `Unsupported deployment target: ${target_input || "(empty)"}`);
  }
  const target: FederationDeploymentTarget = target_input;
  const port = read_optional_number(input, "port");
  if (port !== undefined && (!Number.isInteger(port) || port < 1 || port > 65535)) {
    throw invalid_config(config_path, "deployment.port must be an integer between 1 and 65535.");
  }

  return {
    target,
    host: read_optional_string(input, "host"),
    port,
    url: read_optional_string(input, "url"),
    scripts: normalize_scripts(read_record(input, "scripts")),
    crons: normalize_crons(input.crons, target, config_path),
    resources: normalize_resources(read_record(input, "resources"), target, project_name),
  };
}

/** 校验最多三条 UTC 五字段数字 cron；空数组显式清空定时触发。 */
function normalize_crons(
  input: unknown,
  target: FederationDeploymentTarget,
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
): FederationDeploymentScriptsConfig | undefined {
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
  target: FederationDeploymentTarget,
  project_name: string,
): FederationProjectResourcesConfig {
  if (target === "local") return {};

  const d1 = read_record(input ?? {}, "d1");
  const queue = read_record(input ?? {}, "queue");
  const storage = read_record(input ?? {}, "storage");
  return {
    d1: {
      type: "d1",
      binding: read_string(d1 ?? {}, "binding", "DB"),
      name: read_string(d1 ?? {}, "name", `${project_name}-db`),
    },
    queue: {
      type: "queue",
      binding: read_string(queue ?? {}, "binding", "DOWNCITY_QUEUE"),
      name: read_string(queue ?? {}, "name", `${project_name}-queue`),
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
    title: "Invalid federation.json",
    note: `${config_path}: ${note}`,
    fix: "Run `fed create` to generate the current Federation project format.",
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
