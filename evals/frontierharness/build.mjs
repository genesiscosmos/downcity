/**
 * 本地 checkout 构建入口：复用根 Workspace 依赖，不安装第二份 SDK。
 * 只链接公开 package 入口，运行 tsc，并记录实际源码与构建文件哈希。
 */
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const eval_dir = dirname(fileURLToPath(import.meta.url));
const public_dir = resolve(eval_dir, "../..");
const package_dir = join(public_dir, "packages");
const local_modules = join(eval_dir, "node_modules");

/** 链接现有根 Workspace 的依赖，遇到不一致的已有目录直接失败。 */
function link_dependency(target, destination) {
  if (!existsSync(target)) throw new Error(`Missing dependency: ${target}; install at repository root first`);
  mkdirSync(dirname(destination), { recursive: true });
  if (existsSync(destination)) {
    if (realpathSync(destination) !== realpathSync(target)) throw new Error(`Unexpected dependency at ${destination}`);
    return;
  }
  symlinkSync(target, destination, "dir");
}

for (const name of ["agent", "type", "federation"]) {
  const target = join(package_dir, name);
  if (!existsSync(join(target, "bin/index.js"))) throw new Error(`Build @downcity/${name} first (no bump)`);
  link_dependency(target, join(local_modules, "@downcity", name));
}
for (const name of ["typescript", "@types/node"]) {
  link_dependency(join(package_dir, "agent/node_modules", name), join(local_modules, name));
}
execFileSync(process.execPath, [join(local_modules, "typescript/bin/tsc"), "-p", join(eval_dir, "tsconfig.json"),
  ...(process.argv.includes("--typecheck") ? ["--noEmit"] : [])], { stdio: "inherit" });

/** 对受控目录内文件内容生成哈希；不跟随依赖链接或读取本地凭据。 */
function hash_tree(root, excluded = new Set()) {
  const hash = createHash("sha256");
  function visit(path) {
    for (const name of readdirSync(path).sort()) {
      if (excluded.has(name) || name === ".env" || name.startsWith(".env.")) continue;
      const full_path = join(path, name);
      const stat = lstatSync(full_path);
      if (stat.isSymbolicLink()) continue;
      if (stat.isDirectory()) visit(full_path);
      else if (stat.isFile()) hash.update(relative(root, full_path)).update("\0").update(readFileSync(full_path)).update("\0");
    }
  }
  visit(root);
  return hash.digest("hex");
}

if (!process.argv.includes("--typecheck")) {
  const git = (...args) => execFileSync("git", ["-C", public_dir, ...args], { maxBuffer: 32 * 1024 * 1024 });
  const packages = {};
  for (const name of ["type", "agent", "federation"]) {
    const root = join(package_dir, name);
    packages[name] = {
      version: JSON.parse(readFileSync(join(root, "package.json"), "utf8")).version,
      source_sha256: hash_tree(root, new Set(["node_modules", "bin", ".tsbuildinfo"])),
      build_sha256: hash_tree(join(root, "bin")),
    };
  }
  const snapshot = {
    built_at: new Date().toISOString(),
    node: process.version,
    task_sources: JSON.parse(readFileSync(join(eval_dir, "sources.json"), "utf8")),
    registry: JSON.parse(readFileSync(join(eval_dir, "registry.json"), "utf8")),
    public_head: git("rev-parse", "HEAD").toString().trim(),
    public_status: git("status", "--short").toString(),
    tracked_diff_sha256: createHash("sha256").update(git("diff", "HEAD", "--", "packages/type", "packages/agent", "packages/federation", "pnpm-lock.yaml")).digest("hex"),
    public_lock_sha256: createHash("sha256").update(readFileSync(join(public_dir, "pnpm-lock.yaml"))).digest("hex"),
    workspace_lock_sha256: existsSync(resolve(public_dir, "../pnpm-lock.yaml"))
      ? createHash("sha256").update(readFileSync(resolve(public_dir, "../pnpm-lock.yaml"))).digest("hex") : null,
    packages,
    adapter_source_sha256: hash_tree(eval_dir, new Set(["node_modules", "dist", ".venv", "artifacts", "__pycache__"])),
    runner_sha256: createHash("sha256").update(readFileSync(join(eval_dir, "dist/downcity_runner.js"))).digest("hex"),
    methodology_comparable: false,
  };
  writeFileSync(join(eval_dir, "dist/build-info.json"), JSON.stringify(snapshot, null, 2) + "\n");
  console.log("Built local eval runner and dist/build-info.json (no model or container run)");
}
