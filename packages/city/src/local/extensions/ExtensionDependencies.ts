/**
 * 扩展受管依赖准备。只在快照副本执行固定工具，禁用生命周期脚本，
 * 不读取作者 node_modules，不修改作者 package.json 或锁文件。
 */
import fs from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { ExtensionFailure } from "./ExtensionError.js";

const require = createRequire(import.meta.url);
const run_file = promisify(execFile);
const TOOL_VERSIONS = { npm: "11.6.2", pnpm: "10.22.0" } as const;

/** 准备受支持锁文件对应的精确依赖；返回实际使用的工具和版本。 */
export async function prepare_extension_dependencies(directory: string, signal?: AbortSignal): Promise<string> {
  const names = await fs.readdir(directory);
  const locks = ["package-lock.json", "pnpm-lock.yaml", "yarn.lock", "bun.lock", "bun.lockb", "npm-shrinkwrap.json"].filter((name) => names.includes(name));
  if (locks.length > 1 || locks.some((name) => !["package-lock.json", "pnpm-lock.yaml"].includes(name))) {
    throw new ExtensionFailure("lockfile_unsupported", "Keep exactly one package-lock.json or pnpm-lock.yaml", "dependencies", 2);
  }
  if (!names.includes("package.json")) {
    if (locks.length) throw new ExtensionFailure("dependencies_invalid", "A lockfile requires package.json", "dependencies", 2);
    return "none";
  }
  let manifest: Record<string, unknown>;
  try { manifest = JSON.parse(await fs.readFile(path.join(directory, "package.json"), "utf8")); }
  catch { throw new ExtensionFailure("dependencies_invalid", "package.json must contain a JSON object", "dependencies", 2); }
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) throw new ExtensionFailure("dependencies_invalid", "package.json must contain a JSON object", "dependencies", 2);
  const tool = locks[0] === "pnpm-lock.yaml" ? "pnpm" : "npm";
  const version = TOOL_VERSIONS[tool];
  if (manifest.packageManager !== undefined && manifest.packageManager !== `${tool}@${version}`) {
    throw new ExtensionFailure("package_manager_incompatible", `Host supports ${tool}@${version} for this lockfile`, "dependencies", 2);
  }
  const dependencies = { ...as_dependencies(manifest.dependencies), ...as_dependencies(manifest.devDependencies), ...as_dependencies(manifest.optionalDependencies) };
  for (const [name, specifier] of Object.entries(dependencies)) {
    if (typeof specifier !== "string" || /^(?:file:|link:|workspace:|portal:|git|https?:|ssh:)|^[./~]/iu.test(specifier)) {
      throw new ExtensionFailure("dependency_unsupported", `Dependency ${name} must use a registry version`, "dependencies", 2);
    }
  }
  // 项目配置不能重新启用脚本、插件、任意工具或改写宿主模块解析。
  for (const name of [".npmrc", ".pnpmfile.cjs", "pnpm-workspace.yaml"]) {
    if (names.includes(name)) throw new ExtensionFailure("dependency_configuration_unsupported", `Project ${name} is not supported by managed dependency preparation`, "dependencies", 2);
  }
  if (!Object.keys(dependencies).length && !locks.length) return "none";
  const package_path = require.resolve(tool === "pnpm" ? "pnpm" : "npm/package.json");
  const installed_manifest = JSON.parse(await fs.readFile(package_path, "utf8"));
  if (installed_manifest.version !== version) throw new ExtensionFailure("package_manager_incompatible", "Bundled dependency tool does not match the host contract", "dependencies", 5);
  const executable = path.join(path.dirname(package_path), tool === "npm" ? "bin/npm-cli.js" : "bin/pnpm.cjs");
  const cache_path = path.resolve(directory, "..", "..", "dependencies", tool);
  const arguments_list = tool === "npm"
    ? [locks.length ? "ci" : "install", "--ignore-scripts", "--no-audit", "--no-fund", "--prefer-offline", "--cache", cache_path]
    : ["install", "--ignore-scripts", "--ignore-pnpmfile", "--config.manage-package-manager-versions=false", "--config.verify-deps-before-run=false", "--prefer-offline", ...(locks.length ? ["--frozen-lockfile"] : []), "--store-dir", cache_path];
  try {
    await run_file(process.execPath, [executable, ...arguments_list], {
      cwd: directory, signal, timeout: 180_000, maxBuffer: 1024 * 1024,
      env: { ...process.env, CI: "true", npm_config_ignore_scripts: "true", npm_config_userconfig: path.join(directory, ".downcity-npmrc"), npm_config_globalconfig: path.join(directory, ".downcity-global-npmrc"), npm_config_engine_strict: "true" },
    });
  } catch {
    if (signal?.aborted) throw new ExtensionFailure("cancelled", "Dependency preparation cancelled", "dependencies");
    throw new ExtensionFailure("dependencies_unavailable", "Dependency preparation failed; check registry access, lockfile and Node compatibility", "dependencies");
  }
  await reject_native_dependencies(path.join(directory, "node_modules"));
  return `${tool}@${version}`;
}

/** 仅接受平面依赖记录，不隐式猜测数组或字符串。 */
function as_dependencies(value: unknown): Record<string, unknown> {
  if (value === undefined) return {};
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new ExtensionFailure("dependencies_invalid", "Dependency declarations must be objects", "dependencies", 2);
  return value as Record<string, unknown>;
}

/** 禁止依赖原生构建的模块；不以运行安装脚本修复缺失二进制。 */
async function reject_native_dependencies(directory: string): Promise<void> {
  for (const entry of await fs.readdir(directory, { withFileTypes: true }).catch(() => [])) {
    if (entry.isSymbolicLink()) continue;
    const entry_path = path.join(directory, entry.name);
    if (entry.name === "binding.gyp" || entry.name.endsWith(".node")) throw new ExtensionFailure("native_dependency_unsupported", "Dependencies requiring native binaries or installation scripts are not supported", "dependencies", 2);
    if (entry.isDirectory()) await reject_native_dependencies(entry_path);
  }
}
