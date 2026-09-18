/**
 * 把旧的命名 Profile 配置一次性迁移为每个 Power 一份配置。
 *
 * 脚本会先验证全部候选文件，再创建权限为 0600 的备份并原子替换原文件。
 * 配置值不会写入标准输出，避免凭据进入终端历史或日志。
 *
 * 另外把 Plugin 时代的 `plugins/` 数据目录改名为 `powers/`：目录名随概念改名，
 * 但用户已有的配置必须跟着走，否则升级后会直接看不到。
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parse, stringify } from "smol-toml";

const root_path = path.resolve(
  process.argv[2]
    || process.env.DC_PLATFORM_ROOT
    || path.join(os.homedir(), ".downcity"),
);

/** 判断未知值是否是普通对象。 */
function is_record(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

/** 列出目录中的直接子目录；目录不存在时返回空集合。 */
function list_directories(directory_path) {
  if (!fs.existsSync(directory_path)) return [];
  return fs.readdirSync(directory_path, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
    .map((entry) => entry.name)
    .sort();
}

/**
 * 把 Plugin 时代的 `plugins/` 目录改名为 `powers/`。
 *
 * 关键点（中文）
 * - 两个目录同时存在时不做猜测：无法判断哪一份才是当前事实源，直接失败。
 * - 改写目录名而不复制，避免在大目录上产生两份副本。
 */
function migrate_legacy_plugins_directory() {
  const legacy_path = path.join(root_path, "plugins");
  const current_path = path.join(root_path, "powers");
  if (!fs.existsSync(legacy_path)) return false;
  if (fs.existsSync(current_path)) {
    throw new Error(
      `Both legacy "plugins" and current "powers" directories exist under ${root_path}. `
      + "Resolve which one holds the real Power configs before migrating.",
    );
  }
  fs.renameSync(legacy_path, current_path);
  return true;
}

/** 为旧配置选择唯一迁移来源。 */
function select_config(power_id, profiles) {
  const profile_ids = Object.keys(profiles).sort();
  if (profile_ids.includes("default")) return profiles.default;
  if (profile_ids.length === 0) return {};
  if (profile_ids.length === 1) return profiles[profile_ids[0]];
  throw new Error(
    `Power ${power_id} has multiple profiles without default: ${profile_ids.join(", ")}`,
  );
}

/** 创建 Power 配置迁移计划，不产生写入。 */
function plan_power_configs() {
  const powers_path = path.join(root_path, "powers");
  return list_directories(powers_path).flatMap((power_id) => {
    const file_path = path.join(powers_path, power_id, "config.toml");
    if (!fs.existsSync(file_path)) return [];
    const source = parse(fs.readFileSync(file_path, "utf8"));
    if (source.schema_version === 2 && is_record(source.config)) return [];
    if (!is_record(source.profiles)) {
      throw new Error(`Power ${power_id} does not contain a valid profiles object`);
    }
    const config = select_config(power_id, source.profiles);
    if (!is_record(config)) {
      throw new Error(`Power ${power_id} selected profile is not an object`);
    }
    return [{
      file_path,
      backup_path: `${file_path}.profiles-v1.bak`,
      content: stringify({ schema_version: 2, config }),
    }];
  });
}

/** 创建 Agent 定义清理计划，不产生写入。 */
function plan_agent_definitions() {
  const agents_path = path.join(root_path, "agents");
  return list_directories(agents_path).flatMap((agent_id) => {
    const file_path = path.join(agents_path, agent_id, "agent.json");
    if (!fs.existsSync(file_path)) return [];
    const source = JSON.parse(fs.readFileSync(file_path, "utf8"));
    if (!is_record(source) || !("powers" in source)) return [];
    const { powers: _legacy_powers, ...definition } = source;
    return [{
      file_path,
      backup_path: `${file_path}.powers-v1.bak`,
      content: `${JSON.stringify(definition, null, 2)}\n`,
    }];
  });
}

/** 在产生任何写入前验证全部目标都可以安全迁移。 */
function validate_plans(plans) {
  const backup_paths = new Set();
  for (const plan of plans) {
    if (backup_paths.has(plan.backup_path)) {
      throw new Error(`Migration backup is duplicated: ${plan.backup_path}`);
    }
    backup_paths.add(plan.backup_path);
    if (fs.existsSync(plan.backup_path)) {
      throw new Error(`Migration backup already exists: ${plan.backup_path}`);
    }
  }
}

/** 使用同目录临时文件提交一个迁移计划。 */
function apply_plan(plan) {
  fs.copyFileSync(plan.file_path, plan.backup_path, fs.constants.COPYFILE_EXCL);
  fs.chmodSync(plan.backup_path, 0o600);
  const temporary_path = `${plan.file_path}.${process.pid}.migrate.tmp`;
  fs.writeFileSync(temporary_path, plan.content, { encoding: "utf8", mode: 0o600 });
  fs.renameSync(temporary_path, plan.file_path);
  fs.chmodSync(plan.file_path, 0o600);
}

const renamed_legacy_directory = migrate_legacy_plugins_directory();
const power_plans = plan_power_configs();
const agent_plans = plan_agent_definitions();
const plans = [...power_plans, ...agent_plans];
validate_plans(plans);
for (const plan of plans) apply_plan(plan);
process.stdout.write(
  `Migrated ${power_plans.length} Power config(s) and ${agent_plans.length} Agent definition(s).`
  + `${renamed_legacy_directory ? " Renamed legacy plugins directory to powers." : ""}\n`,
);
