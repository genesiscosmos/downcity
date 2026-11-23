/**
 * `fed create` 命令实现。
 *
 * 关键说明（中文）
 * - 默认在目标目录生成 Local Node.js Downtown。
 * - `--template` 可以选择内置模板，也可以传 Git URL 创建独立项目。
 * - 所有新项目都会获得新的 fed_id，模板仓库自身不成为系统级身份。
 */

import { randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { parse as parse_toml, stringify as stringify_toml } from "smol-toml";
import { confirm, isCancel, text } from "@/downtown/tui/Prompts.js";
import { emitCliBlock } from "@/shared/CliReporter.js";
import { CliError } from "@/shared/CliError.js";
import { runCommand } from "@/downtown/deploy/runtime/CommandRunner.js";
import {
  DEFAULT_DOWNTOWN_TEMPLATE_ID,
  read_downtown_template,
} from "@/downtown/create/templates/TemplateCatalog.js";
import {
  DOWNTOWN_CONFIG_FILE_NAME,
  read_downtown_project_config,
} from "@/downtown/deploy/config/DowntownProjectConfigReader.js";
import type { DowntownTemplateFile } from "@/downtown/types/DowntownTemplate.js";

/** Commander 传入的 create 选项。 */
export interface DowntownCreateCommandOptions {
  /** 是否允许覆盖内置模板将要写入的已有文件。 */
  force?: boolean;
  /** 内置模板 ID 或 Git URL。 */
  template?: string;
}

/** 创建 Downtown 项目。 */
export async function create_downtown_project(
  dir: string = ".",
  options: DowntownCreateCommandOptions = {},
): Promise<void> {
  const project_dir = resolve(String(dir || ".").trim() || ".");
  const default_name = infer_project_name(project_dir);
  const name_input = await text({
    message: "Downtown name",
    initialValue: default_name,
  });
  if (isCancel(name_input)) return;

  const name = normalize_project_name(String(name_input || default_name)) || default_name;
  const fed_id = create_fed_id();
  const template_input = String(options.template || DEFAULT_DOWNTOWN_TEMPLATE_ID).trim();

  if (is_git_url(template_input)) {
    await create_from_git_template({ project_dir, template_url: template_input, fed_id, name });
  } else {
    await create_from_builtin_template({
      project_dir,
      template_id: template_input,
      fed_id,
      name,
      force: options.force === true,
    });
  }

  const config_file = read_downtown_project_config(project_dir);
  emitCliBlock({
    tone: "success",
    title: "Downtown project created",
    facts: [
      { label: "id", value: config_file.config.id },
      { label: "name", value: config_file.config.name },
      { label: "target", value: config_file.config.deployment.target },
      { label: "dir", value: project_dir },
    ],
    note: "Run `fed deploy` from the project directory.",
  });
}

/** 从内置模板生成文件。 */
async function create_from_builtin_template(input: {
  project_dir: string;
  template_id: string;
  fed_id: string;
  name: string;
  force: boolean;
}): Promise<void> {
  const template = read_downtown_template(input.template_id);
  if (!template) {
    throw new CliError({
      title: `Unknown Downtown template: ${input.template_id}`,
      note: "Built-in templates: local-node, cloudflare-workers.",
      fix: "Use a built-in template ID or a Git URL.",
    });
  }

  mkdirSync(input.project_dir, { recursive: true });
  const files = template.create_files({ fed_id: input.fed_id, name: input.name });
  await confirm_file_overwrite(input.project_dir, files, input.force);
  write_template_files(input.project_dir, files);
}

/** 从 Git 模板创建全新项目。 */
async function create_from_git_template(input: {
  project_dir: string;
  template_url: string;
  fed_id: string;
  name: string;
}): Promise<void> {
  if (existsSync(input.project_dir) && readdirSync(input.project_dir).length > 0) {
    throw new CliError({
      title: "Git template target is not empty",
      note: input.project_dir,
      fix: "Choose an empty directory for a Git template.",
    });
  }

  mkdirSync(dirname(input.project_dir), { recursive: true });
  await runCommand({
    label: "Clone Downtown template",
    command: `git clone --depth 1 ${shell_quote(input.template_url)} ${shell_quote(input.project_dir)}`,
    cwd: process.cwd(),
  });
  rmSync(join(input.project_dir, ".git"), { recursive: true, force: true });

  const config_path = join(input.project_dir, DOWNTOWN_CONFIG_FILE_NAME);
  if (!existsSync(config_path)) {
    throw new CliError({
      title: "Git template is missing downtown.toml",
      note: input.template_url,
      fix: "Add a current downtown.toml to the template repository.",
    });
  }

  let config: Record<string, unknown>;
  try {
    config = parse_toml(readFileSync(config_path, "utf-8"));
  } catch (error) {
    throw new CliError({
      title: "Git template downtown.toml is invalid",
      note: error instanceof Error ? error.message : String(error),
    });
  }
  config.schema = 1;
  config.type = "downtown";
  config.id = input.fed_id;
  config.name = input.name;
  writeFileSync(config_path, stringify_toml(config));
}

/** 确认是否覆盖内置模板涉及的已有文件。 */
async function confirm_file_overwrite(
  project_dir: string,
  files: DowntownTemplateFile[],
  force: boolean,
): Promise<void> {
  const existing_files = files
    .map((file) => join(project_dir, file.path))
    .filter((file_path) => existsSync(file_path));
  if (existing_files.length === 0 || force) return;

  const should_overwrite = await confirm({
    message: `${existing_files.length} files already exist. Overwrite them?`,
    initialValue: false,
  });
  if (isCancel(should_overwrite) || should_overwrite !== true) {
    throw new CliError({
      title: "Downtown project creation cancelled",
      note: "Existing files were left unchanged.",
    });
  }
}

/** 将模板文件集合写入项目目录。 */
function write_template_files(project_dir: string, files: DowntownTemplateFile[]): void {
  for (const file of files) {
    const file_path = join(project_dir, file.path);
    mkdirSync(dirname(file_path), { recursive: true });
    writeFileSync(file_path, file.content);
  }
}

/** 创建不依赖路径的稳定 Fed ID。 */
function create_fed_id(): string {
  return `fed_${randomUUID().replace(/-/gu, "")}`;
}

/** 根据目录名推断项目名。 */
function infer_project_name(project_dir: string): string {
  return normalize_project_name(basename(project_dir)) || "downtown";
}

/** 将项目名规范化为可用于资源和 package 的名称。 */
function normalize_project_name(value: string): string {
  return value.trim().toLowerCase()
    .replace(/[^a-z0-9-]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .replace(/-{2,}/gu, "-");
}

/** 判断模板参数是否为 Git URL。 */
function is_git_url(value: string): boolean {
  return /^(https?:\/\/|git:\/\/|git@|ssh:\/\/)/u.test(value)
    || /^[^@\s]+@[^:\s]+:[^\s]+$/u.test(value);
}

/** 对 shell 参数执行单引号转义。 */
function shell_quote(value: string): string {
  return `'${value.replace(/'/gu, "'\\''")}'`;
}
