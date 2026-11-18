/**
 * @file 在独立 public 工作区快照中检查或同步发布锁文件。
 *
 * 仅复制 Git 管理范围内的包清单及 pnpm 配置，不复制依赖、源码或认证文件。
 * 默认离线验证 frozen lockfile；--update 重新解析并仅回写 public/pnpm-lock.yaml。
 * 两种模式均跳过生命周期脚本，不改变联合工作区的依赖安装。
 */
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const workspace_root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const update_lockfile = process.argv.slice(2).includes("--update");
const unknown_arguments = process.argv.slice(2).filter((argument) => argument !== "--update");
if (unknown_arguments.length) throw new Error(`未知参数：${unknown_arguments.join(" ")}`);

const snapshot_directory = mkdtempSync(path.join(tmpdir(), "downcity-release-lockfile-"));
try {
  const manifest_paths = execFileSync("git", [
    "ls-files", "--cached", "--others", "--exclude-standard", "-z", "--",
    "package.json", ":(glob)**/package.json",
  ], { cwd: workspace_root, encoding: "utf8" }).split("\0").filter(Boolean);
  const snapshot_paths = new Set([
    ...manifest_paths, "pnpm-workspace.yaml", "pnpm-lock.yaml", ".npmrc",
  ]);
  for (const relative_path of snapshot_paths) {
    const source_path = path.join(workspace_root, relative_path);
    if (!existsSync(source_path)) continue;
    const target_path = path.join(snapshot_directory, relative_path);
    mkdirSync(path.dirname(target_path), { recursive: true });
    copyFileSync(source_path, target_path);
  }

  console.log(update_lockfile
    ? "同步 public 独立工作区锁文件……"
    : "检查 public 独立工作区 frozen lockfile……");
  execFileSync("pnpm", [
    "install", "--lockfile-only", "--ignore-scripts",
    ...(update_lockfile ? ["--no-frozen-lockfile"] : ["--frozen-lockfile", "--offline"]),
  ], { cwd: snapshot_directory, stdio: "inherit" });
  if (update_lockfile) {
    copyFileSync(path.join(snapshot_directory, "pnpm-lock.yaml"), path.join(workspace_root, "pnpm-lock.yaml"));
    console.log("public/pnpm-lock.yaml 已同步，请检查并提交锁文件差异。");
  }
} catch {
  if (!update_lockfile) {
    console.error("发布锁文件检查失败；修改依赖后请在 public 目录执行 pnpm release:lockfile，再执行 pnpm release:check。");
  }
  process.exitCode = 1;
} finally {
  rmSync(snapshot_directory, { recursive: true, force: true });
}
