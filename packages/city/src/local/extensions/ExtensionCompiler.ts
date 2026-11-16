/**
 * 固定版本 esbuild 源码快照编译。准备阶段只读取源码，不导入入口。
 * Node 输出按代次隔离，宿主 SDK 使用明确模块地址，快照校验覆盖实际产物。
 */
import fs from "node:fs/promises";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import { builtinModules } from "node:module";
import { build, version as esbuild_version } from "esbuild";
import type { ExtensionSource, ExtensionSnapshot, ExtensionPreparationOptions } from "../types/Extension.js";
import { fetch_extension_source } from "./ExtensionSource.js";
import { hash_extension_dependencies } from "./ExtensionDependencyIntegrity.js";
import { assert_extension_sdk_contract } from "./ExtensionSdkContract.js";
import { prepare_extension_dependencies } from "./ExtensionDependencies.js";
import { ExtensionFailure } from "./ExtensionError.js";

export const EXTENSION_COMPILER_VERSION = "esbuild-0.27.7-v2";
const ignored_directories = new Set([".git", "node_modules", ".downcity"]);

/** 在同一文件系统内准备、编译并原子发布一份完整快照。 */
export async function prepare_extension_snapshot(source: ExtensionSource, options: ExtensionPreparationOptions): Promise<ExtensionSnapshot> {
  if (esbuild_version !== "0.27.7") throw new ExtensionFailure("compiler_incompatible", "Host extension compiler version is incompatible", "compile");
  const cache_path = path.join(options.root_path, "extensions", options.extension_id, "cache");
  const snapshot_id = randomUUID();
  const staging_path = path.join(cache_path, `.preparing-${snapshot_id}`);
  const source_path = path.join(staging_path, "source");
  await fs.mkdir(staging_path, { recursive: true, mode: 0o700 });
  try {
    options.signal?.throwIfAborted();
    let commit: string | undefined;
    if (source.kind === "git") {
      commit = await fetch_extension_source(source, source_path, options.signal);
      await fs.rm(path.join(source_path, ".git"), { recursive: true, force: true });
    } else {
      await copy_consistent_source(source.location, source_path, options.signal);
    }
    const entries = (await fs.readdir(source_path)).filter((name) => ["downcity.ts", "downcity.js"].includes(name));
    if (entries.length !== 1) throw new ExtensionFailure(entries.length ? "entry_conflict" : "entry_missing", entries.length ? "Project contains both downcity.ts and downcity.js" : "Project requires downcity.ts or downcity.js at its root", "source", 2);
    let name = path.basename(source.location).replace(/\.git$/u, "");
    try {
      const manifest = JSON.parse(await fs.readFile(path.join(source_path, "package.json"), "utf8"));
      if (typeof manifest.name === "string" && manifest.name.trim()) name = manifest.name;
    } catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw new ExtensionFailure("dependencies_invalid", "package.json must contain valid JSON", "dependencies", 2);
    }
    if (options.previous_snapshot) await reuse_dependency_resolution(source_path, path.join(cache_path, options.previous_snapshot.snapshot_id), options.previous_snapshot);
    await assert_extension_sdk_contract(source_path, options.host_modules);
    await prepare_extension_dependencies(source_path, options.signal);
    const real_source_path = await fs.realpath(source_path);
    const manifest = await fs.readFile(path.join(source_path, "package.json"), "utf8").then((text) => JSON.parse(text), () => ({}));
    const declared_dependencies = new Set(Object.keys({ ...manifest.dependencies, ...manifest.devDependencies, ...manifest.optionalDependencies, ...manifest.peerDependencies }));
    options.signal?.throwIfAborted();
    await build({
      entryPoints: [path.join(source_path, entries[0]!)], outfile: path.join(staging_path, "node", "downcity.mjs"),
      bundle: true, platform: "node", format: "esm", target: "node24", logLevel: "silent", metafile: true,
      loader: { ".png": "file", ".jpg": "file", ".svg": "file", ".woff2": "file" },
      plugins: [{
        name: "downcity-host-and-project-boundary",
        setup(builder) {
          builder.onResolve({ filter: /.*/ }, async (args) => {
            if (args.pluginData === "downcity-resolved") return;
            if (builtinModules.includes(args.path) || args.path.startsWith("node:")) return { path: args.path, external: true };
            const host_module = options.host_modules[args.path];
            if (host_module) return { path: pathToFileURL(host_module).href, external: true };
            if (args.path.startsWith("@downcity/")) throw new Error("SDK module is not exposed by this host");
            if (!args.path.startsWith(".") && !path.isAbsolute(args.path) && !args.path.startsWith("#")) {
              const package_name = args.path.startsWith("@") ? args.path.split("/").slice(0, 2).join("/") : args.path.split("/")[0]!;
              const dependency_importer = args.importer.split(path.sep).includes("node_modules");
              if (!dependency_importer && !declared_dependencies.has(package_name)) throw new Error("Package dependency must be declared in package.json");
            }
            const result = await builder.resolve(args.path, { resolveDir: args.resolveDir, importer: args.importer, kind: args.kind, pluginData: "downcity-resolved" });
            if (result.errors.length) return result;
            if (result.external) return result;
            const actual = await fs.realpath(result.path);
            if (!is_inside(real_source_path, actual)) throw new Error("Import must stay inside the extension project");
            return { path: actual };
          });
        },
      }],
    }).catch((error: unknown) => {
      if (error instanceof ExtensionFailure) throw error;
      throw new ExtensionFailure("compile_failed", "Extension compilation failed; check imports, declared dependencies and project boundaries", "compile", 2);
    });
    const integrity = await hash_extension_tree(staging_path);
    const snapshot: ExtensionSnapshot = { snapshot_id, integrity, entry: "node/downcity.mjs", name, ...(commit ? { commit } : {}), compiler_version: EXTENSION_COMPILER_VERSION, dependency_integrity: await hash_extension_dependencies(source_path), sdk_signature: await extension_sdk_signature(options.host_modules), configuration_version: options.configuration_version, created_at: new Date().toISOString() };
    await fs.writeFile(path.join(staging_path, "snapshot.json"), JSON.stringify(snapshot), { mode: 0o600 });
    await fs.rename(staging_path, path.join(cache_path, snapshot_id));
    return snapshot;
  } catch (error) {
    await fs.rm(staging_path, { recursive: true, force: true });
    throw error;
  }
}

/** 校验完整快照，不在损坏时回退到原目录。 */
export async function verify_extension_snapshot(directory: string, snapshot: ExtensionSnapshot, host_modules?: Readonly<Record<string, string>>): Promise<void> {
  try {
    if (snapshot.dependency_integrity !== await hash_extension_dependencies(path.join(directory, "source"))) throw new Error();
    if (host_modules && snapshot.sdk_signature !== await extension_sdk_signature(host_modules)) throw new Error();
    if (snapshot.compiler_version !== EXTENSION_COMPILER_VERSION || !is_inside(directory, path.resolve(directory, snapshot.entry)) || await hash_extension_tree(directory) !== snapshot.integrity) throw new Error();
  } catch { throw new ExtensionFailure("snapshot_invalid", "Extension snapshot is missing, damaged or incompatible; reload the project", "load"); }
}

/** 宿主 SDK 位置和版本同时绑定，升级或移动安装后要求显式重新加载。 */
async function extension_sdk_signature(host_modules: Readonly<Record<string, string>>): Promise<string> {
  const hash = createHash("sha256");
  for (const [specifier, filename] of Object.entries(host_modules).sort(([left], [right]) => left.localeCompare(right))) {
    hash.update(`${specifier}\0${filename}\0`);
    hash.update(await fs.readFile(filename));
    let directory = path.dirname(filename);
    while (directory !== path.dirname(directory)) {
      const manifest = await fs.readFile(path.join(directory, "package.json"), "utf8").catch(() => null);
      if (manifest) { hash.update(manifest); break; }
      directory = path.dirname(directory);
    }
  }
  return hash.digest("hex");
}

/** 两次独立采集匹配才接受快照，避免不同版本源码混合。 */
async function copy_consistent_source(source: string, destination: string, signal?: AbortSignal): Promise<void> {
  const first = await read_source_tree(source, signal);
  await fs.mkdir(destination, { recursive: true });
  for (const [relative, content] of first) {
    const filename = path.join(destination, relative);
    await fs.mkdir(path.dirname(filename), { recursive: true });
    await fs.writeFile(filename, content);
  }
  const second = await read_source_tree(source, signal);
  if (first.size !== second.size || [...first].some(([name, contents]) => !contents.equals(second.get(name) ?? Buffer.alloc(0)))) throw new ExtensionFailure("source_changed", "Source files changed while preparing the snapshot; retry", "source");
}

/** 相对符号链接只能指向根内，循环由祖先真实路径检测。 */
async function read_source_tree(root: string, signal?: AbortSignal): Promise<Map<string, Buffer>> {
  const result = new Map<string, Buffer>();
  const real_root = await fs.realpath(root);
  async function visit(relative: string, ancestors: Set<string>): Promise<void> {
    signal?.throwIfAborted();
    const actual = await fs.realpath(path.join(root, relative));
    if (actual !== real_root && !is_inside(real_root, actual)) throw new ExtensionFailure("source_symlink_external", "A source symlink points outside the project", "source", 2, { file: relative });
    const stats = await fs.stat(actual);
    if (stats.isDirectory()) {
      if (ancestors.has(actual)) throw new ExtensionFailure("source_symlink_cycle", "Project contains a cyclic symlink", "source", 2, { file: relative });
      const next = new Set([...ancestors, actual]);
      for (const name of (await fs.readdir(actual)).sort()) {
        if (!ignored_directories.has(name)) await visit(path.join(relative, name), next);
      }
    } else if (stats.isFile()) {
      result.set(relative, await fs.readFile(actual));
    } else throw new ExtensionFailure("source_file_unsupported", "Project contains an unsupported filesystem entry", "source", 2, { file: relative });
  }
  await visit("", new Set());
  return result;
}

/** 散列 Node 产物和固定源码；依赖使用独立摘要，浏览器恢复编译前一并校验。 */
export async function hash_extension_tree(root: string): Promise<string> {
  const hash = createHash("sha256");
  async function visit(relative: string): Promise<void> {
    for (const entry of (await fs.readdir(path.join(root, relative), { withFileTypes: true })).sort((left, right) => left.name.localeCompare(right.name))) {
      if (entry.name === "node_modules" || entry.name === "snapshot.json") continue;
      const name = path.join(relative, entry.name);
      if (entry.isSymbolicLink()) throw new Error("Snapshot symlinks are not allowed");
      if (entry.isDirectory()) await visit(name);
      else { hash.update(name.split(path.sep).join("/")); hash.update("\0"); hash.update(await fs.readFile(path.join(root, name))); hash.update("\0"); }
    }
  }
  await visit("");
  return `sha256-${hash.digest("hex")}`;
}

/** 无锁项目在声明兼容时沿用上次实际解析，不在普通重载时暗中升级依赖。 */
async function reuse_dependency_resolution(source_path: string, previous_path: string, previous: ExtensionSnapshot): Promise<void> {
  const names = await fs.readdir(source_path);
  if (names.some((name) => ["package-lock.json", "pnpm-lock.yaml", "yarn.lock", "bun.lock", "bun.lockb", "npm-shrinkwrap.json"].includes(name))) return;
  try {
    await verify_extension_snapshot(previous_path, previous);
    const current = JSON.parse(await fs.readFile(path.join(source_path, "package.json"), "utf8"));
    const old = JSON.parse(await fs.readFile(path.join(previous_path, "source", "package.json"), "utf8"));
    const dependency_key = (manifest: Record<string, unknown>) => JSON.stringify(["dependencies", "devDependencies", "optionalDependencies", "peerDependencies", "packageManager"].map((field) => {
      const value = manifest[field];
      return value && typeof value === "object" ? Object.entries(value).sort(([left], [right]) => left.localeCompare(right)) : value;
    }));
    if (dependency_key(current) !== dependency_key(old)) return;
    for (const name of ["package-lock.json", "pnpm-lock.yaml"]) {
      const lock = await fs.readFile(path.join(previous_path, "source", name)).catch(() => null);
      if (lock) { await fs.writeFile(path.join(source_path, name), lock); return; }
    }
  } catch (error) {
    // 缺少旧缓存不阻止显式重载重新准备，旧运行完整性仍由宿主加载前独立校验。
    if (error instanceof ExtensionFailure && error.code !== "snapshot_invalid") throw error;
  }
}

/** 避免路径前缀误认相邻目录。 */
function is_inside(root: string, filename: string): boolean {
  const relative = path.relative(path.resolve(root), path.resolve(filename));
  return Boolean(relative) && relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}
