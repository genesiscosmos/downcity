/**
 * City 项目版本号管理。
 *
 * 关键点（中文）
 * - `fed deploy` 只在真实云部署前自动执行 patch bump。
 * - 版本号来源统一使用目标项目根目录下的 package.json。
 * - 版本处理逻辑放在 CLI 内部，避免依赖仓库外部脚本。
 * - 老项目如果还没有 version，会在首次真实部署时自动初始化为 `0.0.1`。
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/**
 * City 项目 package.json 中最小需要的字段。
 */
interface ProjectPackageJson extends Record<string, unknown> {
  /**
   * 当前项目版本号。
   */
  version?: unknown;
}

/**
 * 项目版本号 patch bump 结果。
 */
export interface ProjectVersionBumpResult {
  /**
   * package.json 绝对路径。
   */
  package_json_path: string;

  /**
   * bump 前版本号。
   */
  previous_version: string;

  /**
   * bump 后版本号。
   */
  next_version: string;
}

/**
 * 对 City 项目 package.json 执行 patch 版本号自增。
 */
export function bumpProjectPatchVersion(project_dir: string): ProjectVersionBumpResult {
  const package_json_path = join(project_dir, "package.json");
  if (!existsSync(package_json_path)) {
    throw new Error(`City deploy requires package.json: ${package_json_path}`);
  }

  const raw = readFileSync(package_json_path, "utf-8");
  const parsed = JSON.parse(raw) as ProjectPackageJson;
  const previous_version = String(parsed.version ?? "").trim();
  if (!previous_version) {
    const next_version = "0.0.1";
    parsed.version = next_version;
    writeFileSync(package_json_path, JSON.stringify(parsed, null, 2) + "\n", "utf-8");
    return {
      package_json_path,
      previous_version: "(empty)",
      next_version,
    };
  }

  const match = previous_version.match(/^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/);

  if (!match) {
    throw new Error(`Unsupported project version format: ${previous_version || "(empty)"}`);
  }

  const major = Number(match[1]);
  const minor = Number(match[2]);
  const patch = Number(match[3]);
  const next_version = `${major}.${minor}.${patch + 1}`;

  parsed.version = next_version;
  writeFileSync(package_json_path, JSON.stringify(parsed, null, 2) + "\n", "utf-8");

  return {
    package_json_path,
    previous_version,
    next_version,
  };
}
