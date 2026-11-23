/**
 * CLI 自更新模块。
 *
 * 关键说明（中文）
 * - 在 downcity 仓库内执行时，优先走本地 workspace 刷新全局安装
 * - 普通全局安装环境下，退化为 `npm install -g downcity@latest`
 * - 更新完成后建议重新运行 CLI，避免当前进程继续使用旧代码
 */

import { existsSync, readFileSync } from "node:fs";
import { chmod, cp, lstat, mkdir, readFile, rm, symlink } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import os from "node:os";

const CLI_PACKAGE_NAME = "downcity";

/**
 * 执行 CLI 自更新。
 */
export async function updateCli(cwd = process.cwd()): Promise<{
  mode: "workspace" | "npm";
  version: string;
}> {
  const workspaceRoot = findDowncityWorkspaceRoot(cwd);

  if (workspaceRoot) {
    await run(resolve_command_name("pnpm"), ["-C", "packages/cli", "build"], workspaceRoot);
    const deploy_dir = path.join(os.tmpdir(), `downcity-cli-deploy-${Date.now()}`);
    await run(
      resolve_command_name("pnpm"),
      ["--filter", CLI_PACKAGE_NAME, "deploy", "--legacy", deploy_dir],
      workspaceRoot,
    );
    await installCliDeployGlobally(deploy_dir, workspaceRoot);
    await rm(deploy_dir, { recursive: true, force: true });
    return {
      mode: "workspace",
      version: await readInstalledCliVersion(),
    };
  }

  await run(resolve_command_name("npm"), ["install", "-g", `${CLI_PACKAGE_NAME}@latest`], cwd);
  return {
    mode: "npm",
    version: await readInstalledCliVersion(),
  };
}

/**
 * 读取当前全局安装的 CLI 版本。
 */
export async function readInstalledCliVersion(): Promise<string> {
  try {
    const global_paths = await resolveGlobalCliPaths(process.cwd());
    const package_json = JSON.parse(await readFile(path.join(global_paths.package_dir, "package.json"), "utf8")) as {
      version?: string;
    };
    return String(package_json.version ?? "unknown");
  } catch {
    return "unknown";
  }
}

/**
 * 将 pnpm deploy 的 CLI 产物安装到全局 CLI 位置。
 */
async function installCliDeployGlobally(deploy_dir: string, cwd: string): Promise<void> {
  const global_paths = await resolveGlobalCliPaths(cwd);

  // 关键点（中文）：绕开 npm install -g 本地目录，避免 npm 11 Arborist 对本地包的崩溃。
  await mkdir(global_paths.global_modules, { recursive: true });
  await mkdir(global_paths.global_bin, { recursive: true });
  await rm(global_paths.package_dir, { recursive: true, force: true });
  await cp(deploy_dir, global_paths.package_dir, { recursive: true, force: true });
  await chmod(global_paths.city_entry, 0o755);
  await chmod(global_paths.city_entry, 0o755);

  await recreateSymlink(global_paths.city_bin, "../lib/node_modules/downcity/bin/city/index.js");
  await recreateSymlink(global_paths.city_bin, "../lib/node_modules/downcity/bin/city/index.js");
}

/**
 * 解析 npm 全局目录下的 CLI 安装位置。
 */
async function resolveGlobalCliPaths(cwd: string): Promise<{
  npm_prefix: string;
  global_modules: string;
  global_bin: string;
 package_dir: string;
 city_entry: string;
 city_bin: string;
}> {
  const npm_prefix = (await capture(resolve_command_name("npm"), ["prefix", "-g"], cwd)).trim();
  const global_modules = path.join(npm_prefix, "lib", "node_modules");
  const global_bin = path.join(npm_prefix, "bin");
  const package_dir = path.join(global_modules, "downcity");

  return {
    npm_prefix,
    global_modules,
    global_bin,
   package_dir,
   city_entry: path.join(package_dir, "bin", "city", "index.js"),
   city_bin: path.join(global_bin, "city"),
 };
}

/**
 * 重新创建全局命令链接。
 */
async function recreateSymlink(link_path: string, target_path: string): Promise<void> {
  try {
    const stat = await lstat(link_path);
    if (stat.isDirectory()) {
      await rm(link_path, { recursive: true, force: true });
    } else {
      await rm(link_path, { force: true });
    }
  } catch {
    // 链接不存在是正常路径。
  }

  await symlink(target_path, link_path);
}

/**
 * 查找 downcity 仓库根目录。
 */
function findDowncityWorkspaceRoot(startDir: string): string | undefined {
  let current = path.resolve(startDir);

  while (true) {
    if (isDowncityWorkspaceRoot(current)) {
      return current;
    }

    const parent = path.dirname(current);
    if (parent === current) {
      return undefined;
    }
    current = parent;
  }
}

/**
 * 判断某个目录是否为 downcity monorepo 根目录。
 */
function isDowncityWorkspaceRoot(dir: string): boolean {
  const packageJsonPath = path.join(dir, "package.json");
  const workspacePath = path.join(dir, "pnpm-workspace.yaml");
  const cityPackagePath = path.join(dir, "packages", "city", "package.json");

  if (!existsSync(packageJsonPath) || !existsSync(workspacePath) || !existsSync(cityPackagePath)) {
    return false;
  }

  try {
    const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8")) as {
      name?: string;
    };
    return packageJson.name === "downcity";
  } catch {
    return false;
  }
}

/**
 * 运行命令并继承当前终端输出。
 */
function run(command: string, args: string[], cwd: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      stdio: "inherit",
      shell: false,
    });

    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`${command} ${args.join(" ")} exited with code ${code ?? "unknown"}`));
    });
  });
}

/**
 * 运行命令并采集 stdout。
 */
function capture(command: string, args: string[], cwd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
      shell: false,
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });

    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) {
        resolve(stdout);
        return;
      }
      reject(new Error(stderr.trim() || `${command} ${args.join(" ")} exited with code ${code ?? "unknown"}`));
    });
  });
}

/**
 * 根据目标平台解析可执行文件名。
 *
 * Windows 调用 npm 与 pnpm 时必须使用 `.cmd` shim；Node.js 可执行文件不需要后缀。
 */
export function resolve_command_name(
  name: "npm" | "pnpm" | "node",
  platform: NodeJS.Platform = process.platform,
): string {
  if (platform === "win32" && name !== "node") {
    return `${name}.cmd`;
  }
  return name;
}
