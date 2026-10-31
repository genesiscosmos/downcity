/**
 * 独立、可搬迁的本地 Node release 构建与读取。
 *
 * - esbuild 只编译本地入口及相对源码；所有包保留为 external，完整复制生产包。
 * - 真实包存放在 node_modules/.release，依赖链接只指向 release 内部，支持循环和多版本。
 * - workspace 使用已构建的发布文件，不执行安装、生命周期脚本或应用入口。
 * - 项目资源使用 package.json.files；相对项目根目录复制到 app，运行 cwd 应为 app。
 * - 不推断动态文件访问，不携带系统 Node，不承诺跨系统、架构或 Node 版本运行。
 * - 输出目录必须不存在或为空；失败产物由调用方 staging 生命周期清理。
 *
 * 摘要算法：SHA-256(JSON(manifest 去掉 files_digest) + LF + 按 POSIX 路径排序的记录)。
 * 文件记录包含权限和内容 SHA-256，目录记录包含路径，链接记录包含相对目标。
 * release.json 自身不加入文件树，以免产生自引用；其余全部 manifest 字段加入摘要。
 */
import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import * as fs from "node:fs/promises";
import { isBuiltin } from "node:module";
import path from "node:path";
import { build } from "esbuild";
import fast_glob from "fast-glob";
import type { FederationProjectConfigFile } from "../../types/FederationProjectConfig.js";
import type {
  NodeReleaseManifest,
  NodeReleasePackageJson,
  NodeReleasePackageNode,
} from "../../types/NodeRelease.js";

export type { NodeReleaseManifest } from "../../types/NodeRelease.js";

const release_entry = "app/index.mjs";
const package_name_pattern = /^(?:@[a-zA-Z0-9_~.-]+\/)?(?!\.{1,2}$)[a-zA-Z0-9_~.-]+$/;

/** 限制秘密、开发缓存和运行数据进入产物；build/Release 必须保留 native 二进制。 */
function is_excluded(relative_path: string): boolean {
  const segments = relative_path.split(/[\\/]/);
  return segments.some((segment) =>
    /^(?:\.env.*|\.git|\.hg|\.svn|\.cache|\.npm|\.pnpm-store|\.yarn|\.turbo|\.next|\.downcity|\.ssh|\.aws|\.gnupg|coverage|\.DS_Store)$/i.test(segment)
    || /^(?:id_rsa|id_dsa|id_ecdsa|id_ed25519)(?:\..*)?$/i.test(segment)
    || /\.(?:pem|key|p12|pfx|log|sqlite|sqlite3|db)(?:-(?:wal|shm))?$/i.test(segment)
    || /^(?:\.npmrc|\.netrc|\.pypirc)$/i.test(segment));
}

/** 所有协议路径必须是可搬迁、无歧义的 POSIX 相对路径。 */
function assert_relative_path(relative_path: string): void {
  if (!relative_path || relative_path.includes("\\") || /[\x00-\x1f\x7f]/.test(relative_path)
    || path.posix.isAbsolute(relative_path) || /^[a-z]:/i.test(relative_path)
    || relative_path.split("/").some((segment) => !segment || segment === "." || segment === "..")) {
    throw new Error(`Invalid release path: ${JSON.stringify(relative_path)}`);
  }
}

/** 目录包含判断同时用于源文件解引用及产物链接边界校验。 */
function is_within(root_dir: string, candidate: string): boolean {
  const relative_path = path.relative(root_dir, candidate);
  return relative_path === "" || (!relative_path.startsWith(`..${path.sep}`)
    && relative_path !== ".." && !path.isAbsolute(relative_path));
}

/** 缺失依赖可被标为 optional；其他 I/O 错误不能静默吞掉。 */
function is_missing(error: unknown): boolean {
  return !!error && typeof error === "object" && "code" in error
    && (error.code === "ENOENT" || error.code === "ENOTDIR");
}

/** 读取普通文件中的包元数据；拒绝结构错误和秘密文件链接。 */
async function read_package_json(package_dir: string): Promise<NodeReleasePackageJson> {
  const json_path = path.join(package_dir, "package.json");
  const real_path = await fs.realpath(json_path);
  if (!is_within(package_dir, real_path) || is_excluded(path.relative(package_dir, real_path))) {
    throw new Error(`Unsafe package.json: ${json_path}`);
  }
  const package_json = JSON.parse(await fs.readFile(real_path, "utf8"));
  if (!package_json || typeof package_json !== "object" || Array.isArray(package_json)) {
    throw new Error(`Invalid package.json: ${json_path}`);
  }
  for (const field of ["dependencies", "optionalDependencies", "peerDependencies"]) {
    const dependencies = package_json[field];
    if (dependencies !== undefined && (!dependencies || typeof dependencies !== "object"
      || Array.isArray(dependencies) || Object.entries(dependencies).some(([name, version]) =>
        !package_name_pattern.test(name) || name === "." || name === ".." || typeof version !== "string"))) {
      throw new Error(`Invalid ${field}: ${json_path}`);
    }
  }
  if (package_json.files !== undefined && (!Array.isArray(package_json.files)
    || package_json.files.some((item: unknown) => typeof item !== "string"))) {
    throw new Error(`Invalid package files whitelist: ${json_path}`);
  }
  return package_json as NodeReleasePackageJson;
}

/** 按 Node 的父级 node_modules 查找，直接 realpath 解开 pnpm 和 workspace 链接。 */
async function resolve_package_dir(package_name: string, from_dir: string): Promise<string | undefined> {
  if (!package_name_pattern.test(package_name) || package_name === "." || package_name === "..") {
    throw new Error(`Invalid runtime package name: ${package_name}`);
  }
  let current_dir = from_dir;
  while (true) {
    if (path.basename(current_dir) !== "node_modules") {
      const candidate = path.join(current_dir, "node_modules", package_name);
      try {
        const real_dir = await fs.realpath(candidate);
        if (!(await fs.stat(real_dir)).isDirectory()) throw new Error(`Not a package directory: ${candidate}`);
        await fs.access(path.join(real_dir, "package.json"));
        return real_dir;
      } catch (error) {
        if (!is_missing(error)) throw error;
      }
    }
    const parent_dir = path.dirname(current_dir);
    if (parent_dir === current_dir) return undefined;
    current_dir = parent_dir;
  }
}

/** 查找源码所属包，使本地相对引入的 workspace 源文件也能收集生产依赖。 */
async function find_package_dir(file_path: string): Promise<string | undefined> {
  let current_dir = path.dirname(file_path);
  while (true) {
    try {
      await fs.access(path.join(current_dir, "package.json"));
      return await fs.realpath(current_dir);
    } catch (error) {
      if (!is_missing(error)) throw error;
    }
    const parent_dir = path.dirname(current_dir);
    if (parent_dir === current_dir) return undefined;
    current_dir = parent_dir;
  }
}

/** 生产资源复制：文件软链接解引用且必须留在包内，目录软链接拒绝以避免循环或越界。 */
async function copy_resource(
  source_dir: string, output_dir: string, relative_path: string, allow_source: boolean,
): Promise<void> {
  assert_relative_path(relative_path);
  if (is_excluded(relative_path) || relative_path.split("/").includes("node_modules")) return;
  if (!allow_source && /\.(?:[cm]?tsx?|jsx|map)$/.test(relative_path)) return;
  const source_path = path.join(source_dir, relative_path);
  const real_path = await fs.realpath(source_path);
  if (!is_within(source_dir, real_path) || is_excluded(path.relative(source_dir, real_path))) {
    throw new Error(`Resource escapes its package or resolves to excluded data: ${source_path}`);
  }
  const source_stat = await fs.stat(real_path);
  if (!source_stat.isFile()) throw new Error(`Unsupported runtime resource: ${source_path}`);
  const output_path = path.join(output_dir, relative_path);
  await fs.mkdir(path.dirname(output_path), { recursive: true });
  await fs.copyFile(real_path, output_path);
  await fs.chmod(output_path, source_stat.mode & 0o777);
}

/** 文件白名单只控制项目和 workspace；第三方包完整复制运行资源及 native 构建输出。 */
async function copy_package_files(
  source_dir: string, output_dir: string, package_json: NodeReleasePackageJson, project: boolean,
): Promise<void> {
  const workspace = !source_dir.split(path.sep).includes("node_modules");
  const patterns = (workspace || project) && package_json.files ? package_json.files : project ? [] : ["**/*"];
  for (const pattern of patterns) {
    const positive_pattern = pattern.replace(/^!/, "").replace(/^\.\//, "");
    if (path.isAbsolute(positive_pattern) || positive_pattern.split(/[\\/]/).includes("..")) {
      throw new Error(`Package files whitelist escapes package: ${pattern}`);
    }
  }
  const files = await fast_glob(patterns, {
    cwd: source_dir, dot: true, onlyFiles: false, followSymbolicLinks: false,
    ignore: ["**/node_modules/**", "**/.git/**", "**/.cache/**", "**/.pnpm-store/**", "**/.downcity/**"],
  });
  // files 中的目录按 npm 发布语义展开；fast-glob 本身只匹配目录名时不会返回其内容。
  const directories = await fast_glob(patterns, {
    cwd: source_dir, dot: true, onlyDirectories: true, followSymbolicLinks: false,
    ignore: ["**/node_modules/**", "**/.git/**", "**/.cache/**", "**/.pnpm-store/**", "**/.downcity/**"],
  });
  const expanded_files = directories.length ? await fast_glob(
    directories.filter((directory) => !is_excluded(directory)).map((directory) => `${fast_glob.escapePath(directory)}/**/*`),
    { cwd: source_dir, dot: true, onlyFiles: false, followSymbolicLinks: false,
      ignore: ["**/node_modules/**", "**/.git/**", "**/.cache/**", "**/.pnpm-store/**", "**/.downcity/**",
        ...patterns.filter((pattern) => pattern.startsWith("!")).map((pattern) => pattern.slice(1))] },
  ) : [];
  const runtime_files = new Set([...files, ...expanded_files, ...(project ? [] : ["package.json"])]);
  for (const relative_path of [...runtime_files].sort()) {
    if (project && (relative_path === "package.json" || relative_path === "index.mjs")) continue;
    if (workspace && !package_json.files && /^(?:src|test|tests|\.github)\//.test(relative_path)) continue;
    if ((await fs.lstat(path.join(source_dir, relative_path))).isDirectory()) continue;
    await copy_resource(source_dir, output_dir, relative_path, !project);
  }
}

/** 为依赖创建相对内部链接；同一引用名称出现两个版本时不能悄悄覆盖。 */
async function link_package(node_modules_dir: string, name: string, target_dir: string): Promise<void> {
  const link_path = path.join(node_modules_dir, name);
  await fs.mkdir(path.dirname(link_path), { recursive: true });
  const link_target = path.relative(path.dirname(link_path), target_dir);
  try {
    await fs.symlink(link_target, link_path, "dir");
  } catch (error) {
    if (!(error && typeof error === "object" && "code" in error && error.code === "EEXIST")) throw error;
    if (await fs.realpath(link_path) !== target_dir) {
      throw new Error(`Conflicting bundled dependency ${name}; use package imports instead of relative workspace source imports`);
    }
  }
}

/** 静态检查已声明的运行入口，不 import/require 产物或包。 */
async function validate_package_entries(node: NodeReleasePackageNode): Promise<void> {
  const entry_paths = new Set<string>();
  function collect_entries(value: unknown): void {
    if (typeof value === "string" && value.startsWith("./") && !value.includes("*")) entry_paths.add(value);
    else if (Array.isArray(value)) value.forEach(collect_entries);
    else if (value && typeof value === "object") {
      for (const [condition, child] of Object.entries(value)) {
        if (condition.startsWith(".") || ["node", "node-addons", "import", "require", "default"].includes(condition)) {
          collect_entries(child);
        }
      }
    }
  }
  collect_entries(node.package_json.exports);
  if (node.package_json.main && node.package_json.exports === undefined) entry_paths.add(node.package_json.main);
  for (const entry_path of entry_paths) {
    const normalized_path = entry_path.replace(/^\.\//, "");
    assert_relative_path(normalized_path);
    const candidate = path.join(node.output_dir, normalized_path);
    const candidates = [candidate, `${candidate}.js`, `${candidate}.json`, path.join(candidate, "index.js")];
    let found = false;
    for (const possible_path of candidates) {
      try { found = (await fs.stat(possible_path)).isFile(); } catch (error) { if (!is_missing(error)) throw error; }
      if (found) break;
    }
    if (!found) throw new Error(`Missing packaged entry ${entry_path} in ${node.source_dir}; build workspace packages and check package.json.files first`);
  }
  if (node.package_json.name === "better-sqlite3") {
    const binaries = await fast_glob(["**/*.node"], { cwd: node.output_dir, ignore: ["node_modules/**"] });
    if (!binaries.length) throw new Error(`better-sqlite3 has no built native binary: ${node.source_dir}`);
  }
}

/** 流式摘要避免把原生二进制和大资源整体读入内存。 */
async function hash_file(file_path: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(file_path)) hash.update(chunk);
  return hash.digest("hex");
}

/** 摘要扫描不跟随链接；所有链接另行验证实际目标必须位于 release 内。 */
async function digest_release(release_dir: string, manifest: NodeReleaseManifest): Promise<string> {
  const records: string[] = [];
  async function walk(directory: string, prefix: string): Promise<void> {
    for (const name of (await fs.readdir(directory)).sort()) {
      const relative_path = prefix ? `${prefix}/${name}` : name;
      assert_relative_path(relative_path);
      if (is_excluded(relative_path)) throw new Error(`Excluded data in release: ${relative_path}`);
      const file_path = path.join(directory, name);
      const file_stat = await fs.lstat(file_path);
      if (relative_path === "release.json") {
        if (!file_stat.isFile() || file_stat.isSymbolicLink()) throw new Error("release.json must be a regular file");
        continue;
      }
      if (file_stat.isSymbolicLink()) {
        const target = await fs.readlink(file_path);
        if (path.isAbsolute(target) || target.includes("\\")) throw new Error(`Non-relative release link: ${relative_path}`);
        const target_path = await fs.realpath(file_path);
        if (!is_within(release_dir, target_path) || !(await fs.stat(target_path)).isDirectory()) {
          throw new Error(`Release link escapes directory or is not a package directory: ${relative_path}`);
        }
        records.push(JSON.stringify(["link", relative_path, target]));
      } else if (file_stat.isDirectory()) {
        records.push(JSON.stringify(["dir", relative_path]));
        await walk(file_path, relative_path);
      } else if (file_stat.isFile()) {
        records.push(JSON.stringify(["file", relative_path, file_stat.mode & 0o777, await hash_file(file_path)]));
      } else throw new Error(`Unsupported release file: ${relative_path}`);
    }
  }
  await walk(release_dir, "");
  const { files_digest: _files_digest, ...metadata } = manifest;
  return createHash("sha256").update(JSON.stringify(metadata)).update("\n").update(records.sort().join("\n")).digest("hex");
}

/**
 * 构建一个独立的本机 Node release，不安装、启动或执行任何应用代码。
 * output_dir 可为任意 staging 名称；完成后可整体 rename 到 manifest.release_id。
 * 依赖必须预先安装，workspace 发布入口必须预先构建。
 */
export async function build_node_release(
  config_file: FederationProjectConfigFile, output_dir: string,
): Promise<NodeReleaseManifest> {
  const project_dir = await fs.realpath(config_file.project_dir);
  const resolved_output = path.resolve(output_dir);
  if (is_within(resolved_output, project_dir) || is_within(project_dir, resolved_output)) {
    throw new Error("Release staging directory must be outside the source project");
  }
  if (!config_file.config.id || /[\x00-\x1f\x7f]/.test(config_file.config.id)) throw new Error("Missing or invalid federation ID");
  assert_relative_path(config_file.config.entry);
  const source_entry = await fs.realpath(path.join(project_dir, config_file.config.entry));
  if (!is_within(project_dir, source_entry) || is_excluded(path.relative(project_dir, source_entry))) {
    throw new Error("Federation entry escapes the project or points to excluded data");
  }
  await fs.mkdir(resolved_output, { recursive: true });
  if ((await fs.lstat(resolved_output)).isSymbolicLink()) throw new Error("Release output cannot be a symlink");
  if ((await fs.readdir(resolved_output)).length) throw new Error(`Release output must be empty: ${resolved_output}`);
  const release_dir = await fs.realpath(resolved_output);
  if (is_within(release_dir, project_dir) || is_within(project_dir, release_dir)) {
    throw new Error("Release staging directory must be outside the source project");
  }
  const app_dir = path.join(release_dir, "app");
  const root_modules = path.join(release_dir, "node_modules");
  const package_json = await read_package_json(project_dir);
  await fs.mkdir(app_dir, { recursive: true });
  const external_packages = new Map<string, string>();
  const result = await build({
    absWorkingDir: project_dir, entryPoints: [source_entry], outfile: path.join(app_dir, "index.mjs"),
    platform: "node", format: "esm", bundle: true, packages: "external", target: `node${process.versions.node}`,
    metafile: true, write: false, sourcemap: false, logLevel: "silent",
    banner: { js: 'import { createRequire as __release_create_require } from "node:module"; import { fileURLToPath as __release_file_url_to_path } from "node:url"; import { dirname as __release_dirname } from "node:path"; var require = __release_create_require(import.meta.url); var __filename = __release_file_url_to_path(import.meta.url); var __dirname = __release_dirname(__filename);' },
  });
  // 让 esbuild 先应用 tsconfig paths；只处理最终仍 external 的包引用。
  for (const [input, metadata] of Object.entries(result.metafile?.inputs ?? {})) {
    if (is_excluded(input)) throw new Error(`Excluded source input cannot enter release: ${input}`);
    for (const imported of metadata.imports) {
      if (!imported.external || isBuiltin(imported.path)) continue;
      const specifier = imported.path;
      if (specifier.startsWith("#") || specifier.startsWith(".") || path.isAbsolute(specifier)) {
        throw new Error(`Non-portable external import in release: ${specifier}`);
      }
      const name = specifier.startsWith("@") ? specifier.split("/").slice(0, 2).join("/") : specifier.split("/")[0]!;
      const package_dir = await resolve_package_dir(name, path.dirname(path.resolve(project_dir, input)));
      if (!package_dir) throw new Error(`Missing installed runtime dependency ${specifier} from ${input}`);
      const previous_dir = external_packages.get(name);
      if (previous_dir && previous_dir !== package_dir) throw new Error(`Conflicting bundled package versions: ${name}`);
      external_packages.set(name, package_dir);
    }
  }
  await copy_package_files(project_dir, app_dir, package_json, true);
  for (const output_file of result.outputFiles ?? []) {
    if (output_file.path !== path.join(app_dir, "index.mjs")) throw new Error(`Unexpected build output: ${output_file.path}`);
    await fs.writeFile(output_file.path, output_file.contents);
  }
  await fs.writeFile(path.join(app_dir, "package.json"), JSON.stringify({ private: true, type: "module" }, null, 2) + "\n");
  const package_nodes = new Map<string, NodeReleasePackageNode>();
  async function add_package(source_dir: string): Promise<NodeReleasePackageNode> {
    const existing_node = package_nodes.get(source_dir);
    if (existing_node) return existing_node;
    const node: NodeReleasePackageNode = {
      source_dir, output_dir: path.join(root_modules, ".release", `pkg_${package_nodes.size}`),
      package_json: await read_package_json(source_dir),
    };
    package_nodes.set(source_dir, node);
    await fs.mkdir(node.output_dir, { recursive: true });
    await copy_package_files(source_dir, node.output_dir, node.package_json, false);
    await add_dependencies(source_dir, node.package_json, path.join(node.output_dir, "node_modules"));
    await validate_package_entries(node);
    return node;
  }
  async function add_dependencies(
    source_dir: string, source_json: NodeReleasePackageJson, modules_dir: string,
  ): Promise<void> {
    const optional_dependencies = source_json.optionalDependencies ?? {};
    const dependencies = { ...source_json.peerDependencies, ...source_json.dependencies, ...optional_dependencies };
    for (const name of Object.keys(dependencies).sort()) {
      if (isBuiltin(name)) continue;
      const package_dir = await resolve_package_dir(name, source_dir);
      if (!package_dir) {
        const optional = name in optional_dependencies || (!(name in (source_json.dependencies ?? {}))
          && source_json.peerDependenciesMeta?.[name]?.optional === true);
        if (optional) continue;
        throw new Error(`Missing production dependency ${name} in ${source_dir}; install dependencies before building`);
      }
      const dependency_node = await add_package(package_dir);
      await link_package(modules_dir, name, dependency_node.output_dir);
    }
  }
  await fs.mkdir(root_modules, { recursive: true });
  await add_dependencies(project_dir, package_json, root_modules);
  for (const [name, source_dir] of external_packages) {
    const node = await add_package(source_dir);
    await link_package(root_modules, name, node.output_dir);
  }
  const source_packages = new Set<string>();
  for (const input of Object.keys(result.metafile?.inputs ?? {})) {
    const source_package = await find_package_dir(path.resolve(project_dir, input));
    if (source_package && source_package !== project_dir) source_packages.add(source_package);
  }
  for (const source_package of source_packages) {
    await add_dependencies(source_package, await read_package_json(source_package), root_modules);
  }
  const manifest: NodeReleaseManifest = {
    schema: 1, fed_id: config_file.config.id,
    release_id: `${new Date().toISOString().replace(/[-:.]/g, "")}_${randomUUID()}`,
    created_at: new Date().toISOString(),
    app_version: typeof package_json.version === "string" && package_json.version ? package_json.version : "0.0.0",
    entry: release_entry, node_version: process.versions.node, platform: process.platform, arch: process.arch,
    files_digest: "",
  };
  manifest.files_digest = await digest_release(release_dir, manifest);
  await fs.writeFile(path.join(release_dir, "release.json"), JSON.stringify(manifest, null, 2) + "\n", { flag: "wx" });
  return await read_node_release(release_dir, manifest.fed_id, manifest.release_id);
}

/**
 * 异步读取并验证完整发布目录；不会 import、require 或启动入口。
 * 校验身份、schema、路径、当前 Node/平台/架构、内部链接、文件完整性及元数据摘要。
 * release.json 必须最后写入，缺失或损坏的 staging 目录不会被视为有效 release。
 */
export async function read_node_release(
  release_dir: string, expected_fed_id?: string, expected_release_id?: string,
): Promise<NodeReleaseManifest> {
  const manifest = await verify_node_release(release_dir, expected_fed_id, expected_release_id);
  if (manifest.node_version !== process.versions.node || manifest.platform !== process.platform || manifest.arch !== process.arch) {
    throw new Error(`Release requires Node ${manifest.node_version} ${manifest.platform}/${manifest.arch}; current Node ${process.versions.node} ${process.platform}/${process.arch}`);
  }
  return manifest;
}

/** 仅校验产物身份与完整性；清理旧版本不要求它适配当前 Node 运行环境。 */
export async function verify_node_release(
  release_dir: string, expected_fed_id?: string, expected_release_id?: string,
): Promise<NodeReleaseManifest> {
  if (!(await fs.lstat(release_dir)).isDirectory()) throw new Error("Release root must be a real directory");
  const root_dir = await fs.realpath(release_dir);
  const manifest_path = path.join(root_dir, "release.json");
  if (!(await fs.lstat(manifest_path)).isFile()) throw new Error("release.json must be a regular file");
  const raw: unknown = JSON.parse(await fs.readFile(manifest_path, "utf8"));
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("Invalid Node release manifest");
  const fields = ["fed_id", "release_id", "created_at", "app_version", "entry", "node_version", "platform", "arch", "files_digest"] as const;
  if (!("schema" in raw) || raw.schema !== 1 || fields.some((field) => !(field in raw)
    || typeof (raw as Record<string, unknown>)[field] !== "string"
    || !(raw as Record<string, unknown>)[field] || /[\x00-\x1f\x7f]/.test((raw as Record<string, string>)[field]!))
    || Object.keys(raw).some((field) => field !== "schema" && !fields.includes(field as typeof fields[number]))) {
    throw new Error("Unsupported or invalid Node release manifest schema");
  }
  // 重建固定字段顺序，使 release.json 的格式化或 JSON 字段重排不改变摘要。
  const values = raw as NodeReleaseManifest;
  const manifest: NodeReleaseManifest = {
    schema: 1, fed_id: values.fed_id, release_id: values.release_id, created_at: values.created_at,
    app_version: values.app_version, entry: values.entry, node_version: values.node_version,
    platform: values.platform, arch: values.arch, files_digest: values.files_digest,
  };
  if (!/^\d{8}T\d{9}Z_[a-f\d]{8}-[a-f\d]{4}-4[a-f\d]{3}-[89ab][a-f\d]{3}-[a-f\d]{12}$/.test(manifest.release_id)
    || !Number.isFinite(Date.parse(manifest.created_at)) || new Date(manifest.created_at).toISOString() !== manifest.created_at
    || !/^[a-f\d]{64}$/.test(manifest.files_digest)) throw new Error("Invalid release identity, date or digest");
  if (expected_fed_id !== undefined && manifest.fed_id !== expected_fed_id) throw new Error("Release federation ID mismatch");
  if (expected_release_id !== undefined && manifest.release_id !== expected_release_id) throw new Error("Release ID mismatch");
  assert_relative_path(manifest.entry);
  if (manifest.entry !== release_entry) throw new Error(`Unsupported Node release entry: ${manifest.entry}`);
  const entry_path = path.join(root_dir, manifest.entry);
  const entry_stat = await fs.lstat(entry_path);
  if (!entry_stat.isFile() || entry_stat.size === 0 || !is_within(root_dir, await fs.realpath(entry_path))) {
    throw new Error("Missing or unsafe compiled Node release entry");
  }
  if (await digest_release(root_dir, manifest) !== manifest.files_digest) throw new Error("Node release integrity digest mismatch");
  return manifest;
}
