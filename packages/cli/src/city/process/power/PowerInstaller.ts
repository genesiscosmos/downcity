/**
 * 第三方单 Power 包安装器。
 *
 * 来源目录可以包含源码与任意开发工具；安装目录只保留清单、运行入口、README、图标
 * 和用户自己的 `config.toml`。Power 定义的唯一 ID 同时是公开身份和最终目录名。
 */

import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import fs from "fs-extra";
import { execa } from "execa";
import { get_local_power_path } from "@downcity/city/local";
import { create_cli_local_data } from "@/city/runtime/LocalData.js";
import {
  get_installed_power,
  is_builtin_power,
  normalize_power_id,
} from "@/city/process/registry/PowerRepository.js";
import {
  POWER_DEFINITION_FILE_NAME,
  POWER_DEFINITION_SCHEMA_VERSION,
  type InstalledPower,
  type PowerPackageDefinition,
  type ResolvedPowerSource,
} from "@/city/types/power/PowerDefinition.js";

const POWER_CONFIG_FILE_NAME = "config.toml";
const POWER_PACKAGE_FILE_NAME = "package.json";

/** 从本地目录、Git URL 或 GitHub shorthand 安装一个 Power。 */
export async function install_power(
  source_input: string,
  expected_power_id?: string,
): Promise<InstalledPower> {
  const source = await resolve_power_source(source_input);
  const data = create_cli_local_data();
  const root_path = data.root_path;
  const powers_root = path.join(root_path, "powers");
  data.database.close();
  await fs.ensureDir(powers_root, { mode: 0o700 });
  const source_dir = path.join(powers_root, `.source-${randomUUID()}`);
  const staging_dir = path.join(powers_root, `.install-${randomUUID()}`);
  const backup_dir = path.join(powers_root, `.backup-${randomUUID()}`);
  let revision: string | undefined;

  try {
    let power_root = source.local_path;
    if (!power_root) {
      const clone_arguments = ["clone", "--depth", "1"];
      if (source.git_ref) clone_arguments.push("--branch", source.git_ref);
      clone_arguments.push(source.git_url!, source_dir);
      await execa("git", clone_arguments, { stdio: "pipe" });
      const revision_result = await execa("git", ["rev-parse", "HEAD"], {
        cwd: source_dir,
        stdio: "pipe",
      });
      revision = revision_result.stdout.trim() || undefined;
      power_root = source_dir;
    }

    await assert_power_package_file(
      power_root,
      POWER_DEFINITION_FILE_NAME,
      "definition",
    );
    const package_path = await assert_power_package_file(
      power_root,
      POWER_PACKAGE_FILE_NAME,
      "package",
    );
    await validate_power_package(package_path);
    const definition = await read_power_definition(power_root);
    const readme_path = await assert_power_package_file(
      power_root,
      definition.readme,
      "README",
    );
    if (expected_power_id && definition.id !== normalize_power_id(expected_power_id)) {
      throw new Error(`Power update changed ID: ${expected_power_id} -> ${definition.id}`);
    }
    if (is_builtin_power(definition.id)) {
      throw new Error(`Power ID conflicts with builtin Power: ${definition.id}`);
    }
    const declared_entries: Array<[label: string, relative_path: string]> = [];
    if (definition.main) declared_entries.push(["main", definition.main]);
    if (definition.renderer) declared_entries.push(["renderer", definition.renderer.entry]);
    const entry_paths = await Promise.all(declared_entries.map(async ([label, relative_path]) => [
      relative_path,
      await assert_power_package_file(power_root, relative_path, label),
    ] as const));
    const icon_path = definition.icon && is_local_power_asset(definition.icon)
      ? await assert_power_package_file(power_root, definition.icon, "icon")
      : undefined;

    await fs.ensureDir(staging_dir, { mode: 0o700 });
    const installed_package_path = path.join(staging_dir, POWER_PACKAGE_FILE_NAME);
    await fs.copyFile(package_path, installed_package_path);
    await fs.chmod(installed_package_path, 0o600);
    const installed_readme_path = resolve_power_path(staging_dir, definition.readme, "README");
    await fs.ensureDir(path.dirname(installed_readme_path), { mode: 0o700 });
    await fs.copyFile(readme_path, installed_readme_path);
    await fs.chmod(installed_readme_path, 0o600);
    for (const [relative_path, source_path] of entry_paths) {
      const installed_path = resolve_power_path(staging_dir, relative_path, "entry");
      await fs.ensureDir(path.dirname(installed_path), { mode: 0o700 });
      await fs.copyFile(source_path, installed_path);
      await fs.chmod(installed_path, 0o600);
    }
    if (icon_path && definition.icon) {
      const installed_icon_path = resolve_power_path(staging_dir, definition.icon, "icon");
      await fs.ensureDir(path.dirname(installed_icon_path), { mode: 0o700 });
      await fs.copyFile(icon_path, installed_icon_path);
      await fs.chmod(installed_icon_path, 0o600);
    }
    const integrity = await calculate_power_integrity(staging_dir, [
      POWER_PACKAGE_FILE_NAME,
      definition.readme,
      ...[definition.main, definition.renderer?.entry]
        .filter((item): item is string => Boolean(item)),
      ...(definition.icon && is_local_power_asset(definition.icon) ? [definition.icon] : []),
    ]);
    const existing = get_installed_power(definition.id);
    const target_dir = get_local_power_path(root_path, definition.id);
    const existing_config = path.join(target_dir, POWER_CONFIG_FILE_NAME);
    if (await fs.pathExists(existing_config)) {
      await fs.copy(existing_config, path.join(staging_dir, POWER_CONFIG_FILE_NAME));
    }
    const current_time = new Date().toISOString();
    const installed: InstalledPower = {
      ...definition,
      source: source.normalized_source,
      ...(revision ? { revision } : {}),
      integrity,
      installed_at: existing?.installed_at ?? current_time,
      updated_at: current_time,
    };
    await fs.writeJson(path.join(staging_dir, POWER_DEFINITION_FILE_NAME), installed, {
      spaces: 2,
      EOL: "\n",
    });
    await fs.chmod(path.join(staging_dir, POWER_DEFINITION_FILE_NAME), 0o600);

    if (await fs.pathExists(target_dir)) await fs.move(target_dir, backup_dir);
    try {
      await fs.move(staging_dir, target_dir);
    } catch (error) {
      await fs.remove(target_dir);
      if (await fs.pathExists(backup_dir)) await fs.move(backup_dir, target_dir);
      throw error;
    }
    await fs.remove(backup_dir);
    return installed;
  } finally {
    await fs.remove(source_dir);
    await fs.remove(staging_dir);
    await fs.remove(backup_dir);
  }
}

/** 使用 Power 自己保存的来源更新目录。 */
export async function update_power(power_id_input: string): Promise<InstalledPower> {
  const power_id = normalize_power_id(power_id_input);
  const power = get_installed_power(power_id);
  if (!power) throw new Error(`Power is not installed: ${power_id}`);
  return await install_power(power.source, power_id);
}

/** 读取并严格验证 Power 根目录中的唯一静态定义。 */
export async function read_power_definition(
  power_root: string,
): Promise<PowerPackageDefinition> {
  const definition_path = path.join(power_root, POWER_DEFINITION_FILE_NAME);
  if (!await fs.pathExists(definition_path)) {
    throw new Error(`Missing ${POWER_DEFINITION_FILE_NAME}`);
  }
  const raw = await fs.readJson(definition_path) as Record<string, unknown>;
  assert_known_fields(
    raw,
    [
      "schema_version",
      "id",
      "version",
      "title",
      "description",
      "readme",
      "icon",
      "main",
      "renderer",
      "source",
      "revision",
      "integrity",
      "installed_at",
      "updated_at",
    ],
    "Power definition",
  );
  if (raw.schema_version !== POWER_DEFINITION_SCHEMA_VERSION) {
    throw new Error(
      `Power schema_version must be ${POWER_DEFINITION_SCHEMA_VERSION}`,
    );
  }
  const id = normalize_power_id(String(raw.id || ""));
  if (raw.id !== id) throw new Error(`Power ID must be normalized: ${raw.id}`);
  const version = String(raw.version || "").trim();
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/u.test(version)) {
    throw new Error(`Power version must be semantic: ${version}`);
  }
  const description = String(raw.description || "").trim();
  if (!description) throw new Error(`Power description is required: ${id}`);
  const readme = normalize_power_readme(raw.readme, power_root, id);
  const icon = normalize_power_icon(raw.icon, id);
  const main = normalize_power_entry(raw.main, power_root, "main", [".js", ".mjs"]);
  const renderer = normalize_power_renderer(raw.renderer, power_root);
  if (!main && !renderer) {
    throw new Error(`Power must provide main or renderer: ${id}`);
  }
  const title = typeof raw.title === "string" ? raw.title.trim() : "";
  return {
    schema_version: 1,
    id,
    version,
    ...(title ? { title } : {}),
    description,
    readme,
    ...(icon ? { icon } : {}),
    ...(main ? { main } : {}),
    ...(renderer ? { renderer } : {}),
  };
}

/** 校验 Renderer 入口及其静态 UI 插槽。 */
function normalize_power_renderer(
  value: unknown,
  power_root: string,
): PowerPackageDefinition["renderer"] {
  if (value === undefined || value === null) return undefined;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Power renderer must be an object");
  }
  const raw = value as Record<string, unknown>;
  assert_known_fields(raw, ["entry", "sidebar", "mainview", "config"], "Power renderer");
  const entry = normalize_power_entry(raw.entry, power_root, "renderer.entry", [".js", ".mjs"]);
  if (!entry) throw new Error("Power renderer.entry is required");
  for (const key of ["sidebar", "mainview", "config"] as const) {
    if (typeof raw[key] !== "boolean") throw new Error(`Power renderer.${key} must be boolean`);
  }
  const sidebar = raw.sidebar as boolean;
  const mainview = raw.mainview as boolean;
  const config = raw.config as boolean;
  if (sidebar !== mainview) {
    throw new Error("Power renderer.sidebar and renderer.mainview must be declared together");
  }
  if (!sidebar && !config) throw new Error("Power renderer must provide a workspace UI or config");
  return { entry, sidebar, mainview, config };
}

/** 校验并规范化 Power 必需的 Markdown 用户文档路径。 */
function normalize_power_readme(
  value: unknown,
  power_root: string,
  power_id: string,
): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`Power readme is required: ${power_id}`);
  }
  const readme = value.trim().replace(/\\/gu, "/");
  if (path.isAbsolute(readme) || path.win32.isAbsolute(readme)) {
    throw new Error(`Power readme must be relative: ${power_id}`);
  }
  if (path.posix.extname(readme).toLowerCase() !== ".md") {
    throw new Error(`Power readme must use .md: ${power_id}`);
  }
  resolve_power_path(power_root, readme, "README");
  return readme;
}

/** 校验并规范化 Power 的一个可选运行入口。 */
function normalize_power_entry(
  value: unknown,
  power_root: string,
  label: string,
  extensions: string[],
): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string") throw new Error(`Power ${label} must be a string`);
  const entry = value.trim();
  if (!entry) return undefined;
  if (!extensions.includes(path.extname(entry).toLowerCase())) {
    throw new Error(`Power ${label} must use ${extensions.join(" or ")}`);
  }
  resolve_power_path(power_root, entry, label);
  return entry.split(path.sep).join("/");
}

/** 校验并规范化 Power 图标地址。 */
function normalize_power_icon(value: unknown, power_id: string): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string") throw new Error(`Power icon must be a string: ${power_id}`);
  const icon = value.trim();
  if (!icon) return undefined;
  if (/^https?:\/\//iu.test(icon)) return icon;
  if (/^[a-z][a-z0-9+.-]*:/iu.test(icon)) {
    throw new Error(`Power icon protocol is not supported: ${icon}`);
  }
  return icon.split(path.sep).join("/");
}

/** 判断图标是否为 Power 根目录内的本地资源。 */
function is_local_power_asset(icon: string): boolean {
  return !/^https?:\/\//iu.test(icon);
}

/** 安全解析 Power 根目录内的静态路径。 */
export function resolve_power_path(
  power_root: string,
  relative_path: string,
  label: string,
): string {
  const root = path.resolve(power_root);
  const resolved = path.resolve(root, relative_path);
  if (resolved === root || !resolved.startsWith(`${root}${path.sep}`)) {
    throw new Error(`Power ${label} must stay inside the Power directory`);
  }
  return resolved;
}

/** 解析 local、Git URL 与 GitHub shorthand。 */
async function resolve_power_source(source_input: string): Promise<ResolvedPowerSource> {
  const source = String(source_input || "").trim();
  if (!source) throw new Error("Power source is required");
  const local_path = path.resolve(source);
  if (await fs.pathExists(local_path)) {
    if (!(await fs.stat(local_path)).isDirectory()) {
      throw new Error("Local Power source must be a directory");
    }
    return { normalized_source: local_path, local_path };
  }
  const github_match = /^github:([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:#(.+))?$/u.exec(source);
  if (github_match) {
    const owner = github_match[1]!;
    const repository = github_match[2]!.replace(/\.git$/u, "");
    const git_ref = github_match[3]?.trim() || undefined;
    return {
      normalized_source: `github:${owner}/${repository}${git_ref ? `#${git_ref}` : ""}`,
      git_url: `https://github.com/${owner}/${repository}.git`,
      ...(git_ref ? { git_ref } : {}),
    };
  }
  const fragment_index = source.lastIndexOf("#");
  const git_url = fragment_index > 0 ? source.slice(0, fragment_index) : source;
  const git_ref = fragment_index > 0 ? source.slice(fragment_index + 1).trim() : "";
  if (!/^(?:https?:\/\/|ssh:\/\/|git@)[^\s]+$/u.test(git_url)) {
    throw new Error("Power source must be a local directory, Git URL, or github:owner/repo#ref");
  }
  return {
    normalized_source: `${git_url}${git_ref ? `#${git_ref}` : ""}`,
    git_url,
    ...(git_ref ? { git_ref } : {}),
  };
}

/**
 * 验证安装协议实际读取的文件。
 *
 * 逐段拒绝符号链接，确保入口不会借助来源目录中的链接改变真实位置。与安装无关的源码、
 * 构建配置和版本库文件不会被读取，也不会进入安装目录。
 */
async function assert_power_package_file(
  power_root: string,
  relative_path: string,
  label: string,
): Promise<string> {
  const resolved_path = resolve_power_path(power_root, relative_path, label);
  const normalized_relative_path = path.relative(path.resolve(power_root), resolved_path);
  const segments = normalized_relative_path.split(path.sep);
  let current_path = path.resolve(power_root);

  for (const [index, segment] of segments.entries()) {
    current_path = path.join(current_path, segment);
    let stats: fs.Stats;
    try {
      stats = await fs.lstat(current_path);
    } catch {
      throw new Error(`Power ${label} not found: ${relative_path}`);
    }
    if (stats.isSymbolicLink()) {
      throw new Error(`Power ${label} cannot use symlinks: ${relative_path}`);
    }
    const is_last_segment = index === segments.length - 1;
    if (!is_last_segment && !stats.isDirectory()) {
      throw new Error(`Power ${label} path is invalid: ${relative_path}`);
    }
    if (is_last_segment && !stats.isFile()) {
      throw new Error(`Power ${label} must be a file: ${relative_path}`);
    }
  }
  return resolved_path;
}

/** 校验 `package.json` 建立了明确的 ESM package 边界。 */
async function validate_power_package(package_path: string): Promise<void> {
  let package_definition: unknown;
  try {
    package_definition = await fs.readJson(package_path);
  } catch (error) {
    throw new Error("Power package.json must contain valid JSON", { cause: error });
  }
  if (!is_json_object(package_definition) || package_definition.type !== "module") {
    throw new Error('Power package.json must declare "type": "module"');
  }
}

/** 计算 Power package 边界与自包含入口的稳定 SHA-256 摘要。 */
async function calculate_power_integrity(root: string, files: string[]): Promise<string> {
  const hash = createHash("sha256");
  for (const relative_path of [...files].sort((left, right) => left.localeCompare(right))) {
    hash.update(relative_path.split(path.sep).join("/"));
    hash.update("\0");
    hash.update(await fs.readFile(resolve_power_path(root, relative_path, "package file")));
    hash.update("\0");
  }
  return `sha256-${hash.digest("hex")}`;
}

/** 拒绝 Power definition 中无法识别的字段。 */
function assert_known_fields(
  value: Record<string, unknown>,
  allowed_fields: string[],
  label: string,
): void {
  const allowed = new Set(allowed_fields);
  const unknown_field = Object.keys(value).find((field) => !allowed.has(field));
  if (unknown_field) throw new Error(`${label} contains unknown field: ${unknown_field}`);
}

/** 判断外部 JSON 值是否为普通对象。 */
function is_json_object(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
