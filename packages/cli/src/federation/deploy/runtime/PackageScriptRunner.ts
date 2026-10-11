/**
 * City 项目 package scripts 执行器。
 *
 * 关键点（中文）
 * - 普通开发者不需要在 `federation.json` 里声明 build/typecheck。
 * - 如果项目 package.json 有对应 script，`fed deploy` 自动执行。
 * - 没有 package.json 或没有脚本时安静跳过，保持最小项目可部署。
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { runCommand } from "@/federation/deploy/runtime/CommandRunner.js";
import type {
  FederationPackageDeployScriptsResult,
  FederationPackageScriptResult,
} from "@/federation/types/FederationDeployRuntime.js";

/** package.json 中和部署相关的脚本信息。 */
interface PackageScripts {
  /** 是否存在 build script。 */
  build: boolean;
  /** 是否存在 typecheck script。 */
  typecheck: boolean;
}

/**
 * 自动执行 package.json 中的 build/typecheck。
 */
export async function runPackageDeployScripts(params: {
  /** City 项目目录。 */
  project_dir: string;
  /** 是否跳过 build。 */
  skip_build: boolean;
  /** 是否跳过 typecheck。 */
  skip_typecheck: boolean;
}): Promise<FederationPackageDeployScriptsResult> {
  const scripts = readPackageScripts(params.project_dir);
  const build = await resolvePackageScriptResult({
    project_dir: params.project_dir,
    script_name: "build",
    exists: scripts.build,
    skipped: params.skip_build,
  });
  const typecheck = await resolvePackageScriptResult({
    project_dir: params.project_dir,
    script_name: "typecheck",
    exists: scripts.typecheck,
    skipped: params.skip_typecheck,
  });
  return { build, typecheck };
}

/**
 * 解析并执行单个 package script。
 */
async function resolvePackageScriptResult(params: {
  /** City 项目目录。 */
  project_dir: string;
  /** package script 名称。 */
  script_name: "build" | "typecheck";
  /** package.json 是否包含该 script。 */
  exists: boolean;
  /** 是否被命令行选项跳过。 */
  skipped: boolean;
}): Promise<FederationPackageScriptResult> {
  const command = `pnpm ${params.script_name}`;
  if (params.skipped) {
    return { command, status: "skipped" };
  }

  if (!params.exists) {
    return { command, status: "missing" };
  }

  await runPackageScript(params.project_dir, params.script_name);
  return { command, status: "passed" };
}

/**
 * 读取 package.json 中是否存在部署相关脚本。
 */
function readPackageScripts(project_dir: string): PackageScripts {
  const package_json_path = join(project_dir, "package.json");
  if (!existsSync(package_json_path)) {
    return { build: false, typecheck: false };
  }

  try {
    const parsed = JSON.parse(readFileSync(package_json_path, "utf-8")) as {
      scripts?: Record<string, unknown>;
    };
    return {
      build: typeof parsed.scripts?.build === "string",
      typecheck: typeof parsed.scripts?.typecheck === "string",
    };
  } catch {
    return { build: false, typecheck: false };
  }
}

/**
 * 执行 package script。
 */
async function runPackageScript(
  project_dir: string,
  script_name: "build" | "typecheck",
): Promise<void> {
  await runCommand({
    label: script_name,
    command: `pnpm ${script_name}`,
    cwd: project_dir,
    capture: true,
  });
}
